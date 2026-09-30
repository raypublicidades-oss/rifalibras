import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).send('OK');

  try {
    const paymentId = req.body?.data?.id || req.query?.['data.id'] || req.body?.id;

    if (paymentId) {
      // Consulta o status direto no Mercado Pago
      const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: { 'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}` }
      });
      const paymentInfo = await mpRes.json();

      // Se foi aprovado/pago
      if (paymentInfo.status === 'approved') {
        await supabase
          .from('cotas')
          .update({ status: 'pago' })
          .eq('mercado_pago_id', String(paymentId));
      }
    }

    return res.status(200).json({ status: 'ok' });
  } catch (err) {
    console.error(err);
    return res.status(200).json({ status: 'error' });
  }
}