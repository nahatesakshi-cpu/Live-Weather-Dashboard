# Weatherly — Weather Intelligence Dashboard

Weatherly is a responsive, no-build weather dashboard built with HTML, CSS and vanilla JavaScript. It uses live Open-Meteo forecast, geocoding and air-quality services; no API key or paid subscription is required.

## Project files

```text
Weatherly/
├── index.html
├── style.css
├── script.js
└── README.md
```

## Run locally

1. Open the project folder in Visual Studio Code.
2. Install the **Live Server** extension if it is not already installed.
3. Right-click `index.html` and choose **Open with Live Server**.
4. Allow network access for the Open-Meteo APIs and the Chart.js, Leaflet, and font CDNs.

The app also works from another local HTTP server. Geolocation and clipboard access generally require `localhost` or HTTPS; they may not work when opening the file directly with `file://`.

## Data sources and libraries

- City search: [Open-Meteo Geocoding API](https://geocoding-api.open-meteo.com/v1/search)
- Current conditions and forecasts: [Open-Meteo Forecast API](https://api.open-meteo.com/v1/forecast)
- Pollutants and European AQI: [Open-Meteo Air Quality API](https://air-quality-api.open-meteo.com/v1/air-quality)
- Charts: [Chart.js 4.4.7](https://www.chartjs.org/) via jsDelivr
- Interactive map: [Leaflet 1.9.4](https://leafletjs.com/) and [OpenStreetMap](https://www.openstreetmap.org/) tiles
- Typography: DM Sans and Outfit via Google Fonts

No weather values are hardcoded. If air-quality data is unavailable, the rest of the forecast remains usable and the AQI panel explains the missing data.

## Features

- City search with geocoding autocomplete, plus browser voice search where supported.
- Current conditions, apparent temperature, humidity, wind, precipitation, UV index, sunrise/sunset and daylight duration.
- Horizontally scrollable hourly forecast for up to 24 hours and a 7-day forecast.
- European AQI and PM2.5, PM10, NO₂ and O₃. AQI categories use the European 0–100+ modelled scale: Good (under 20), Fair (20–39), Moderate (40–59), Poor (60–79), and Very Poor (80+). Pollutant concentrations are in μg/m³.
- Dynamic temperature, weekly high/low, humidity and wind charts. Chart instances are destroyed and recreated on city changes; values follow the Celsius/Fahrenheit selection.
- Favourite cities and recent searches stored locally in the browser.
- City comparison (two to five places), weather map markers, geolocation, share/copy, theme preference, and configurable automatic refresh.
- Clothing and umbrella tips based on forecast data, plus threshold-based forecast advisories.
- Responsive dark and light themes with weather-sensitive current-condition styling.

### Alerts and forecast guidance

The Open-Meteo forecast endpoint used here does not provide authoritative, location-specific emergency alert bulletins. The alerts panel therefore reports only relevant signals derived from actual forecast weather codes, precipitation probability/amount, and wind speed, and explicitly says when no signal is detected. It is not a substitute for government or local emergency alerts.

Recommendations are simple guidance generated from the returned forecast, not medical or safety advice. AQI and weather values are modelled forecasts and may differ from local measurements.

## Settings and privacy

Theme, refresh interval, recent places and favourites stay in `localStorage` on the current browser. No account or app backend is used. Weather and geocoding requests send the entered place or coordinates to Open-Meteo. Map tile requests go to OpenStreetMap tile servers. Geolocation is requested only after selecting **Use my location** and depends on browser permission.

## Test checklist

With the page served over Live Server:

1. Search for Nagpur, Mumbai, Delhi and Pune; confirm current conditions, hourly forecast, daily forecast, charts, AQI and map update for each.
2. Search for a made-up city and confirm a useful error appears without replacing the last successful dashboard.
3. Toggle °C/°F; verify current and feels-like values, hourly/daily forecasts, charts (including tooltips), and comparison cards change units.
4. Add and remove a favourite, reload the page, then confirm favourite and recent search data persists. Clear recent history and verify it is empty.
5. Test AQI values and pollutant fields when the API returns them; verify the panel degrades gracefully if the Air Quality API is unavailable.
6. Compare at least two cities and click a result to select it.
7. Change light/dark mode, reload, and confirm the preference persists. Try each refresh interval and the manual refresh control.
8. Test geolocation with permission allowed and denied. Test voice and sharing on supported browsers, and clipboard fallback on an insecure/unsupported context as applicable.
9. Temporarily disconnect the network or block an API/CDN request; verify errors are visible and the app does not show fabricated data.
10. Use browser responsive mode at phone, tablet and desktop widths; inspect the browser console for errors.

## Deploy to GitHub Pages

1. Create a GitHub repository and add `index.html`, `style.css`, `script.js` and `README.md` to its root.
2. Push the files to the default branch.
3. In the repository, open **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**, select the default branch and the `/(root)` folder, then save.
5. Wait for the Pages deployment and open the URL GitHub provides. Geolocation and clipboard features require the secure HTTPS Pages URL.

All asset references are CDN URLs and the project has no build step. An internet connection is required for live weather, map tiles, charts, and externally hosted fonts.
