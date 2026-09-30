import { createClient } from '@supabase/supabase-js';

// Mapeia para as variáveis que já estão configuradas na Vercel
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://swgdyqkiaxfovvsxfwav.supabase.co";
// Usa a chave Service Role se existir, ou cai no fallback da Anon Key cadastrada
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  try {
    const { numeros, nome, email, telefone } = req.body;

    if (!numeros || !Array.isArray(numeros) || numeros.length === 0) {
      return res.status(400).json({ error: 'Nenhum número selecionado.' });
    }

    // 1. Verificar disponibilidade dos números
    const { data: cotasExistentes, error: fetchError } = await supabase
      .from('cotas')
      .select('numero, status')
      .in('numero', numeros);

    if (fetchError) throw fetchError;

    const indisponiveis = cotasExistentes.filter(c => c.status !== 'disponivel');
    if (indisponiveis.length > 0) {
      return res.status(400).json({ error: 'Alguns números escolhidos já não estão disponíveis.' });
    }

    // 2. Definir o valor para TESTES (R$ 0,01 fixo)
    const valorTotal = 0.01;

    // 3. Criar Pagamento no Mercado Pago
    const tokenMP = process.env.MP_ACCESS_TOKEN || process.env.MP_ACCESS_TOKEN_TEST;

    const mpResponse = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokenMP}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': `pix-${Date.now()}-${Math.random()}`
      },
      body: JSON.stringify({
        transaction_amount: valorTotal,
        description: `Rifa Libras - Cotas: ${numeros.join(', ')}`,
        payment_method_id: 'pix',
        payer: {
          email: email,
          first_name: nome,
          phone: {
            area_code: telefone.replace(/\D/g, '').substring(0, 2) || '61',
            number: telefone.replace(/\D/g, '').substring(2) || '999999999'
          }
        },
        notification_url: 'https://rifalibras.vercel.app/api/webhook'
      })
    });

    const paymentData = await mpResponse.json();

    if (!mpResponse.ok) {
      console.error('Erro Mercado Pago:', paymentData);
      return res.status(500).json({ error: paymentData.message || 'Erro ao gerar Pix no Mercado Pago.' });
    }

    // 4. Reservar números no Supabase
    const { error: updateError } = await supabase
      .from('cotas')
      .update({
        status: 'pendente',
        nome_comprador: nome,
        email_comprador: email,
        telefone_comprador: telefone,
        payment_id: String(paymentData.id),
        updated_at: new Date().toISOString()
      })
      .in('numero', numeros);

    if (updateError) throw updateError;

    // 5. Retornar dados do Pix
    return res.status(200).json({
      success: true,
      payment_id: paymentData.id,
      pix_copia_cola: paymentData.point_of_interaction.transaction_data.qr_code,
      pix_qr_code_base64: paymentData.point_of_interaction.transaction_data.qr_code_base64
    });

  } catch (err) {
    console.error('Erro geral no Pix:', err);
    return res.status(500).json({ error: err.message || 'Erro interno no servidor.' });
  }
}
