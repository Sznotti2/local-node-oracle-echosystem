const express = require('express');
const app = express();

const port = 5000;
const ip = '0.0.0.0';

const CITY_TEMPERATURES = {
    "London": 15,
    "Paris": 18,
    "NewYork": 22,
    "Tokyo": 25,
    "Sydney": 28,
    "Moscow": 5,
    "Dubai": 35,
    "Berlin": 12,
    "Rome": 20,
    "Madrid": 23,
    "Szeged": 31,
};

app.get('/weather', (req, res) => {
    const city = req.query.city;

	console.log(req.url);

    if (!city) {
        return res.status(400).json({ error: "City parameter is required" });
    }

    const temperature = CITY_TEMPERATURES[city];

    if (temperature === undefined) {
        return res.status(404).json({ error: `City '${city}' not found` });
    }

    res.json({ temperature: temperature });
});

app.listen(port, ip, () => {
    console.log(`Express server running on http://${ip}:${port}`);
});