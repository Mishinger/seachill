function calcScore(actual, target, tolerance) {
  const diff = Math.abs(actual - target);
  return diff <= tolerance ? 10 : Math.max(0, 10 - (diff - tolerance));
}

app.get("/beach", async (req, res) => {
  const { lat, lng, preferredTemp, seaTemp, tempTolerance, windLimit, hour = "c" } = req.query;

  if (!lat || !lng) return res.status(400).json({ error: "Missing lat/lng" });

  try {
    const marineURL = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lng}&hourly=sea_surface_temperature,wave_height,sea_level_height_msl&current=sea_surface_temperature,wave_height&forecast_hours=24&timezone=auto`;
    const weatherURL = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=temperature_2m,relative_humidity_2m,uv_index,windspeed_10m,weather_code&current=temperature_2m,relative_humidity_2m,uv_index,windspeed_10m,weather_code&forecast_hours=24&timezone=auto`;

    const [marineRes, weatherRes] = await Promise.all([fetch(marineURL), fetch(weatherURL)]);
    const marine = await marineRes.json();
    const weather = await weatherRes.json();

    let dataPoint;

    if (hour === "c") {
      dataPoint = {
        air: weather.current.temperature_2m,
        sea: marine.current.sea_surface_temperature,
        wind: weather.current.windspeed_10m,
        humidity: weather.current.relative_humidity_2m,
        uv: weather.current.uv_index,
        wave: marine.current.wave_height,
        condition: weather.current.weather_code
      };
    } else if (hour.startsWith("n")) {
      const n = parseInt(hour.slice(1));
      dataPoint = Array.from({ length: n }).map((_, i) => ({
        hour: weather.hourly.time[i],
        air: weather.hourly.temperature_2m[i],
        sea: marine.hourly.sea_surface_temperature[i],
        wind: weather.hourly.windspeed_10m[i],
        humidity: weather.hourly.relative_humidity_2m[i],
        uv: weather.hourly.uv_index[i],
        wave: marine.hourly.wave_height[i],
        condition: weather.hourly.weather_code[i]
      }));
    } else {
      const h = parseInt(hour);
      const idx = weather.hourly.time.findIndex(t => new Date(t).getHours() === h);
      if (idx === -1) return res.status(404).json({ error: `Hour ${h} not found in forecast` });

      dataPoint = {
        hour: weather.hourly.time[idx],
        air: weather.hourly.temperature_2m[idx],
        sea: marine.hourly.sea_surface_temperature[idx],
        wind: weather.hourly.windspeed_10m[idx],
        humidity: weather.hourly.relative_humidity_2m[idx],
        uv: weather.hourly.uv_index[idx],
        wave: marine.hourly.wave_height[idx],
        condition: weather.hourly.weather_code[idx]
      };
    }

    let recommendation = null;

    if (preferredTemp && seaTemp && tempTolerance && windLimit) {
      const parsePref = n => parseFloat(n);
      const pTemp = parsePref(preferredTemp);
      const pSea = parsePref(seaTemp);
      const tol = parsePref(tempTolerance);

      const scoreFn = (pt) => {
        return {
          airScore: calcScore(pt.air, pTemp, tol),
          seaScore: calcScore(pt.sea, pSea, tol),
          total: Math.min(10, calcScore(pt.air, pTemp, tol) + calcScore(pt.sea, pSea, tol) - (pt.wind > windMax ? pt.wind - windMax : 0))
        };
      };

      recommendation = Array.isArray(dataPoint)
        ? dataPoint.map(dp => ({ hour: dp.hour, ...scoreFn(dp) }))
        : scoreFn(dataPoint);
    }

    res.json({
      location: { lat, lng },
      time: new Date().toISOString(),
      forecast: dataPoint,
      recommendation
    });

  } catch (err) {
    res.status(500).json({ error: "Fetch failed", message: err.message });
  }
});