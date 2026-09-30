import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://swgdyqkiaxfovvsxfwav.supabase.co";
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

    // 1. Libera cotas pendentes há mais de 30 minutos no banco
    await supabase.rpc('expirar_cotas_pendentes');

    // 2. Verifica se os números escolhidos estão disponíveis
    const { data: cotasExistentes, error: fetchError } = await supabase
      .from('cotas')
      .select('numero, status')
      .in('numero', numeros);

    if (fetchError) {
      console.error('Erro Supabase Fetch:', fetchError);
      throw new Error('Erro ao consultar banco de dados.');
    }

    const indisponiveis = cotasExistentes.filter(c => c.status !== 'disponivel');
    if (indisponiveis.length > 0) {
      return res.status(400).json({ error: 'Alguns números escolhidos já não estão disponíveis.' });
    }

    // 3. Configura o Mercado Pago (R$ 0,01 fixo para teste)
    const valorTotal = 0.01;
    const tokenMP = process.env.MP_ACCESS_TOKEN || process.env.MP_ACCESS_TOKEN_TEST;

    if (!tokenMP) {
      throw new Error('Token do Mercado Pago não configurado na Vercel.');
    }

    const mpResponse = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokenMP}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': `pix-${Date.now()}-${Math.random()}`
      },
      body: JSON.stringify({
        transaction_amount: valorTotal,
        description: `Rifa - Cotas: ${numeros.join(', ')}`,
        payment_method_id: 'pix',
        payer: {
          email: email || 'cliente@exemplo.com',
          first_name: nome || 'Comprador',
          phone: {
            area_code: (telefone || '61999999999').replace(/\D/g, '').substring(0, 2) || '61',
            number: (telefone || '61999999999').replace(/\D/g, '').substring(2) || '999999999'
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

    // 4. Reservar números como 'pendente' e salvar nome, telefone, email e payment_id
    const { error: updateError } = await supabase
      .from('cotas')
      .update({
        status: 'pendente',
        nome: nome || null,
        telefone: telefone || null,
        email: email || null,
        payment_id: String(paymentData.id),
        updated_at: new Date().toISOString()
      })
      .in('numero', numeros);

    if (updateError) {
      console.error('Erro Supabase Update:', updateError);
      throw new Error('Erro ao reservar cotas no banco.');
    }

    return res.status(200).json({
      success: true,
      payment_id: paymentData.id,
      pix_copia_cola: paymentData.point_of_interaction.transaction_data.qr_code,
      pix_qr_code_base64: paymentData.point_of_interaction.transaction_data.qr_code_base64
    });

  } catch (err) {
    console.error('Erro interno:', err);
    return res.status(500).json({ error: err.message || 'Erro interno no servidor.' });
  }
}
