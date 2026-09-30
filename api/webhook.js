import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://swgdyqkiaxfovvsxfwav.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  try {
    const { type, data } = req.body;

    // Mercado Pago envia a notificação como 'payment'
    if (type === 'payment' || req.query.topic === 'payment') {
      const paymentId = data ? data.id : req.query.id;

      if (!paymentId) {
        return res.status(200).send('OK sem ID');
      }

      const tokenMP = process.env.MP_ACCESS_TOKEN || process.env.MP_ACCESS_TOKEN_TEST;

      // Consulta o status real do pagamento no Mercado Pago
      const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: {
          'Authorization': `Bearer ${tokenMP}`
        }
      });

      if (!mpResponse.ok) {
        return res.status(200).send('Erro ao buscar pagamento no MP');
      }

      const paymentInfo = await mpResponse.json();

      // Se o status for aprovado, muda a cota no Supabase para 'pago'
      if (paymentInfo.status === 'approved') {
        const { error } = await supabase
          .from('cotas')
          .update({ 
            status: 'pago',
            updated_at: new Date().toISOString()
          })
          .eq('payment_id', String(paymentId));

        if (error) {
          console.error('Erro ao atualizar status para pago:', error);
        }
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Erro no webhook:', err);
    return res.status(200).send('OK com erro'); // Retorna 200 para o Mercado Pago não travar tentativas
  }
}
