// Local-only server for the Admin Hub "Stream Counter" tool. Serves the
// whole site as static files (so adminhub/counter.html can call the API
// same-origin, no CORS needed) and exposes POST /api/generate-counter,
// which is the only thing on this repo with permission to write outside
// the repo itself: it drives Textcraft's actual Pokemon-style generator
// (see gentext3.php below) and overwrites the local stream image.
//
// Started via start-counter.bat (double-click it, or a desktop shortcut to
// it) rather than run continuously — it's only needed the rare times a
// stream is actually happening. That script also opens the browser straight
// to the right page once the server's up.
//
// Run with: node adminhub/stream-counter-server/server.js
// Then open: http://localhost:4747/adminhub/counter.html

const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

const PORT = process.env.PORT || 4747;
const SITE_ROOT = path.join(__dirname, '..', '..');
const OUTPUT_DIR = 'D:\\Libraries\\Desktop\\leisure\\streaming';
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'currentNum.png');
const TEMP_FILE = path.join(OUTPUT_DIR, 'currentNum.tmp.png');

// Every param here is copied verbatim from a captured working gentext3.php
// request for the Pokemon Textcraft style — only `text` ever changes.
// Do not "clean up" or reorder without re-verifying against Textcraft.
function buildTextcraftUrl(text) {
    const params = new URLSearchParams();
    params.set('text', text);
    params.set('text2', '');
    params.set('text3', '');
    params.set('font_style', 'font31');
    params.set('font_size', 'x2');
    params.set('font_colour', '117');
    params.set('bgcolour', '#2C262E');
    params.set('glow_halo', '0');
    params.set('glossy', '0');
    params.set('lighting', '0');
    params.set('fit_lines', '0');
    params.set('truecolour_images', '0');
    params.set('non_trans', 'false');
    params.set('glitter_border', 'true');
    params.set('text_border', '8');
    params.set('border_colour', '#000000');
    params.set('anim_type', 'none');
    params.set('submit_type', 'text');
    params.set('perspective_effect', '0');
    params.set('drop_shadow', '1');
    params.set('savedb', '0');
    params.set('multiline', '0');
    params.set('font_style2', 'font32');
    params.set('font_style3', 'font32');
    params.set('font_size2', 'm');
    params.set('font_size3', 'm');
    params.set('font_colour2', '98');
    params.set('font_colour3', '98');
    params.set('text_border2', '5');
    params.set('text_border3', '5');
    params.set('border_colour2', '#2D59A8');
    params.set('border_colour3', '#2D59A8');
    return `https://textcraft.net/gentext3.php?${params.toString()}`;
}

// Textcraft is only ever hit once per button click from the frontend, but
// this guards against double-clicks / overlapping requests still landing
// here concurrently and racing on the same output file.
let generationInProgress = false;

const app = express();

app.use(express.json());
app.use(express.static(SITE_ROOT));

app.post('/api/generate-counter', async (req, res) => {
    if (generationInProgress) {
        return res.status(429).json({ success: false, error: 'A generation is already in progress — try again in a moment.' });
    }

    const { number, total } = req.body || {};
    if (!Number.isInteger(number) || number < 0 || !Number.isInteger(total) || total < 0) {
        return res.status(400).json({ success: false, error: 'number and total must be non-negative whole numbers.' });
    }

    generationInProgress = true;
    try {
        const url = buildTextcraftUrl(`${number}/${total}`);

        let xml;
        try {
            const response = await axios.get(url, { timeout: 15000, responseType: 'text' });
            xml = response.data;
        } catch (err) {
            throw new Error(`Could not reach Textcraft: ${err.message}`);
        }

        let parsed;
        try {
            parsed = new XMLParser().parse(xml);
        } catch (err) {
            throw new Error('Textcraft returned malformed XML.');
        }

        const image = parsed && parsed.image;
        if (!image || image.result !== 'ok') {
            throw new Error(`Textcraft did not return a successful result (got "${image && image.result}").`);
        }

        const { datadir, fullfilename } = image;
        if (!datadir || !fullfilename) {
            throw new Error('Textcraft response was missing datadir/fullfilename.');
        }

        const imageUrl = `https://static1.textcraft.net/${datadir}/${fullfilename}`;

        let imageBuffer;
        try {
            const imgResponse = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 15000 });
            imageBuffer = Buffer.from(imgResponse.data);
        } catch (err) {
            throw new Error(`Failed to download the generated image: ${err.message}`);
        }

        if (!imageBuffer.length) {
            throw new Error('Downloaded image was empty.');
        }

        // Write to a temp file first and rename over the real one, so OBS
        // (which may be reading currentNum.png at any moment) never sees a
        // partially-written file.
        try {
            fs.mkdirSync(OUTPUT_DIR, { recursive: true });
            fs.writeFileSync(TEMP_FILE, imageBuffer);
            fs.renameSync(TEMP_FILE, OUTPUT_FILE);
        } catch (err) {
            throw new Error(`Failed to write local image file: ${err.message}`);
        }

        res.json({ success: true, number, total, imageUrl });
    } catch (err) {
        console.error(err);
        res.status(502).json({ success: false, error: err.message });
    } finally {
        generationInProgress = false;
    }
});

app.listen(PORT, () => {
    console.log(`Stream counter server running — open http://localhost:${PORT}/adminhub/counter.html`);
});
