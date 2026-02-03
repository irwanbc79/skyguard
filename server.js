
// HS CODE API ROUTES - BTKI 2022
app.get('/api/hs-codes/chapter/:chapter', async (req, res) => {
    try {
        const chapter = req.params.chapter.padStart(2, '0');
        const codes = await db.collection('hs_codes').find({ chapter }).sort({ hs_code: 1 }).toArray();
        res.json(codes);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/hs-codes/search', async (req, res) => {
    try {
        const q = req.query.q || '';
        if (q.length < 2) return res.json([]);
        const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        const codes = await db.collection('hs_codes').find({
            $or: [{ hs_code: regex }, { description_id: regex }, { description_en: regex }]
        }).sort({ hs_code: 1 }).limit(100).toArray();
        res.json(codes);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/hs-codes/detail/:code', async (req, res) => {
    try {
        const code = decodeURIComponent(req.params.code);
        const hs = await db.collection('hs_codes').findOne({ hs_code: code });
        hs ? res.json(hs) : res.status(404).json({ error: 'Not found' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
