const https = require('https');
const selfsigned = require('selfsigned');
const express = require('express');

const app = express();
app.get('/test', (req, res) => res.json({ ok: true }));

const attrs = [{ name: 'commonName', value: 'localhost' }];
const pems = selfsigned.generate(attrs, { days: 1 });

const server = https.createServer({
    key: pems.private,
    cert: pems.cert
}, app);

server.listen(3002, () => {
    console.log('Test server on 3002');
});
