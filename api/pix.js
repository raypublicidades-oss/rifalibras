import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const { numeros, nome, email, telefone } = req.body;

  if (!numeros || !numeros.length || !nome || !email || !telefone) {
    return res.status(400).json({ error: 'Dados incompletos.' });
  }

  try {
    // 1. Limpa reservas antigas expiradas
    await supabase.rpc('limpar_reservas_expiradas');

    // 2. Verifica se a pessoa já excedeu o limite de 10 números
    const { data: cotasExistentes } = await supabase
      .from('cotas')
      .select('numero')
      .or(`email.eq.${email},telefone.eq.${telefone}`)
      .in('status', ['pendente', 'pago']);

    const totalAtual = (cotasExistentes ? cotasExistentes.length : 0) + numeros.length;
    if (totalAtual > 10) {
      return res.status(400).json({ error: `Você só pode reservar no máximo 10 números no total.` });
    }

    // 3. Verifica se algum número selecionado foi pego no meio do caminho
    const { data: disponiveis } = await supabase
      .from('cotas')
      .select('numero')
      .in('numero', numeros)
      .eq('status', 'disponivel');

    if (!disponiveis || disponiveis.length !== numeros.length) {
      return res.status(400).json({ error: 'Um ou mais números selecionados já foram reservados.' });
    }

    // 4. Cria a cobrança Pix no Mercado Pago
    const valorTotal = numeros.length * 10;
    const mpRes = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        transaction_amount: valorTotal,
        description: `Rifa Beneficente - Cotas: ${numeros.join(', ')}`,
        payment_method_id: 'pix',
        payer: {
          email: email,
          first_name: nome,
        }
      })
    });

    const mpData = await mpRes.json();

    if (!mpRes.ok) {
      console.error(mpData);
      return res.status(500).json({ error: 'Erro ao gerar o Pix no Mercado Pago.' });
    }

    const pix_copia_cola = mpData.point_of_interaction.transaction_data.qr_code;
    const pix_qr_code_base64 = mpData.point_of_interaction.transaction_data.qr_code_base64;
    const mercado_pago_id = String(mpData.id);

    // 5. Marca os números como 'pendente' no Supabase
    await supabase
      .from('cotas')
      .update({
        status: 'pendente',
        nome,
        email,
        telefone,
        pix_copia_cola,
        pix_qr_code_base64,
        mercado_pago_id,
        created_at: new Date().toISOString()
      })
      .in('numero', numeros);

    return res.status(200).json({
      pix_copia_cola,
      pix_qr_code_base64,
      mercado_pago_id
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}