const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
}
const db = admin.firestore();

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { uid, orderId } = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    if (!uid || !orderId) return res.status(400).json({ error: 'uid/orderId missing' });

    const APP_ID = (process.env.APP_ID || 'dev-ayurveda-pro-auth').trim();
const base = db.collection('artifacts').doc(APP_ID).collection('users').doc(uid);
    const base = db.collection('artifacts').doc(process.env.APP_ID).collection('users').doc(uid);
    const orderRef = base.collection('onlineOrders').doc(orderId);
    const snap = await orderRef.get();
    if (!snap.exists) return res.status(404).json({ error: 'order not found' });
    const o = snap.data();
    if (o.status !== 'pending' || o.pushedAt) return res.status(200).json({ skipped: true });

    const tokensSnap = await base.collection('fcmTokens').get();
    const tokens = tokensSnap.docs.map(d => d.id);
    if (!tokens.length) return res.status(200).json({ sent: 0 });

    const total = Number(o.total || o.grandTotal || 0);
    const r = await admin.messaging().sendEachForMulticast({
      tokens,
      data: {
        type: 'order',
        category: 'order',
        title: '🛒 New online order',
        body: `${o.customerName || 'Customer'} ne order diya${total ? ' — ₹' + total.toLocaleString('en-IN') : ''}`,
        actionType: 'order', actionId: orderId, dedupeKey: 'weborder_' + orderId,
        url: './index.html?action=orders'
      },
      webpush: { headers: { Urgency: 'high', TTL: '86400' } }
    });

    const dead = [];
    r.responses.forEach((x, i) => {
      if (!x.success && /registration-token-not-registered|invalid-registration-token/.test(x.error && x.error.code)) dead.push(tokens[i]);
    });
    await Promise.all(dead.map(t => base.collection('fcmTokens').doc(t).delete()));

    await orderRef.update({ pushedAt: Date.now() });
    res.status(200).json({ sent: r.successCount, failed: r.failureCount });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
};
