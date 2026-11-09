"use strict";

const $ = (selector) => document.querySelector(selector);
const STORAGE = { favorites: "weatherly:favorites", recent: "weatherly:recent", theme: "weatherly:theme", interval: "weatherly:interval" };
const elements = {
  form: $("#searchForm"), input: $("#cityInput"), search: $("#searchBtn"), location: $("#locationBtn"),
  unit: $("#unitToggle"), theme: $("#themeToggle"), refresh: $("#refreshBtn"), interval: $("#refreshInterval"),
  voice: $("#voiceBtn"), share: $("#shareBtn"), status: $("#statusMessage"), statusText: $("#statusText"),
  retry: $("#retryBtn"), content: $("#weatherContent"),
  suggestions: $("#suggestions"), forecasts: $("#forecastGrid"), hourly: $("#hourlyForecast"),
  favorites: $("#favoritesList"), recent: $("#recentList"), compareForm: $("#compareForm"),
  compareInput: $("#compareInput"), compareResults: $("#compareResults"), updated: $("#lastUpdated")
};

let isCelsius = true;
let currentPlace = null;
let currentWeather = null;
let currentAir = null;
let activeRefresh = null;
let requestVersion = 0;
let lastRefreshTimestamp = 0;
let suggestionTimer = 0;
let charts = {};
let map = null;
let mapMarkers = new Map();
let favoritePlaces = readStorage(STORAGE.favorites, []);
let recentPlaces = readStorage(STORAGE.recent, []);

function readStorage(key, fallback) {
  try {
    const stored = JSON.parse(localStorage.getItem(key));
    return Array.isArray(fallback) && !Array.isArray(stored) ? fallback : (stored ?? fallback);
  } catch {
    return fallback;
  }
}

function saveStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`Could not save ${key} in local storage.`, error);
    showStatus("Browser storage is unavailable; this preference may not persist.", true);
  }
}

function weatherInfo(code) {
  const map = {
    0: ["Clear sky", "☀"], 1: ["Mainly clear", "🌤"], 2: ["Partly cloudy", "⛅"], 3: ["Overcast", "☁"],
    45: ["Fog", "🌫"], 48: ["Rime fog", "🌫"], 51: ["Light drizzle", "🌦"], 53: ["Drizzle", "🌦"],
    55: ["Heavy drizzle", "🌧"], 56: ["Freezing drizzle", "🌧"], 57: ["Freezing drizzle", "🌧"],
    61: ["Light rain", "🌧"], 63: ["Rain", "🌧"], 65: ["Heavy rain", "🌧"], 66: ["Freezing rain", "🌧"],
    67: ["Freezing rain", "🌧"], 71: ["Light snow", "🌨"], 73: ["Snow", "🌨"], 75: ["Heavy snow", "❄"],
    77: ["Snow grains", "❄"], 80: ["Rain showers", "🌦"], 81: ["Showers", "🌧"], 82: ["Heavy showers", "⛈"],
    85: ["Snow showers", "🌨"], 86: ["Heavy snow showers", "❄"], 95: ["Thunderstorm", "⛈"],
    96: ["Thunderstorm with hail", "⛈"], 99: ["Severe thunderstorm with hail", "⛈"]
  };
  return map[code] || ["Conditions unavailable", "◌"];
}

function temperature(value) {
  if (!Number.isFinite(value)) return "—";
  const converted = isCelsius ? value : value * 9 / 5 + 32;
  return `${Math.round(converted)}°${isCelsius ? "C" : "F"}`;
}

function showStatus(message, isError = false, retry = null) {
  elements.statusText.textContent = message;
  elements.status.classList.toggle("error", isError);
  elements.retry.classList.toggle("hidden", typeof retry !== "function");
  elements.retry.onclick = typeof retry === "function" ? retry : null;
  elements.status.classList.remove("hidden");
}

function hideStatus() {
  elements.status.classList.add("hidden");
  elements.retry.classList.add("hidden");
  elements.retry.onclick = null;
}

function setLoading(loading) {
  elements.search.disabled = loading;
  elements.location.disabled = loading;
  elements.refresh.disabled = loading;
  elements.search.textContent = loading ? "Loading…" : "Search";
  elements.content.classList.toggle("loading", loading);
}

function formatValue(value, unit, digits = 0) {
  return Number.isFinite(value) ? `${Number(value).toFixed(digits)}${unit}` : "—";
}

async function fetchJson(url, label) {
  const response = await fetch(url);
  if (!response.ok) {
    if (response.status === 429) throw new Error(`${label} rate limit reached. Please wait a moment and retry.`);
    throw new Error(`${label} request failed (HTTP ${response.status}).`);
  }
  return response.json();
}

async function searchPlaces(query, count = 5) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=${count}&language=en&format=json`;
  const data = await fetchJson(url, "City search");
  return data.results || [];
}

function weatherUrl(latitude, longitude) {
  const params = new URLSearchParams({
    latitude, longitude,
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m,uv_index",
    hourly: "temperature_2m,weather_code,precipitation,precipitation_probability,wind_speed_10m,relative_humidity_2m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max",
    timezone: "auto", forecast_days: "7", wind_speed_unit: "kmh"
  });
  return `https://api.open-meteo.com/v1/forecast?${params}`;
}

function airUrl(latitude, longitude) {
  const params = new URLSearchParams({
    latitude, longitude,
    current: "european_aqi,pm2_5,pm10,nitrogen_dioxide,ozone",
    timezone: "auto"
  });
  return `https://air-quality-api.open-meteo.com/v1/air-quality?${params}`;
}

async function loadPlace(place, options = {}) {
  const version = ++requestVersion;
  const { remember = true, refreshing = false } = options;
  setLoading(true);
  showStatus(refreshing ? "Refreshing live weather…" : "Fetching live weather and air quality…");
  try {
    const weather = await fetchJson(weatherUrl(place.latitude, place.longitude), "Weather");
    if (version !== requestVersion) return;
    let air = null;
    try {
      air = await fetchJson(airUrl(place.latitude, place.longitude), "Air quality");
    } catch (error) {
      console.warn("Air-quality data is unavailable.", error);
    }
    if (version !== requestVersion) return;
    if (!weather.current || !weather.daily || !weather.hourly) {
      throw new Error("Weather service returned incomplete forecast data.");
    }
    currentPlace = place;
    currentWeather = weather;
    currentAir = air;
    renderDashboard();
    lastRefreshTimestamp = Date.now();
    if (remember) addRecent(place);
    updateMap(place);
    elements.updated.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    hideStatus();
    elements.content.classList.remove("hidden");
  } catch (error) {
    if (version === requestVersion) showStatus(error.message || "Unable to load weather. Check your connection and retry.", true, () => loadPlace(place, options));
  } finally {
    if (version === requestVersion) setLoading(false);
  }
}

async function loadCity(query) {
  const city = query.trim();
  if (!city) {
    showStatus("Enter a city name to search.", true);
    return;
  }
  const version = ++requestVersion;
  setLoading(true);
  showStatus(`Finding ${city}…`);
  try {
    const matches = await searchPlaces(city, 1);
    if (version !== requestVersion) return;
    if (!matches.length) throw new Error(`No matching city found for “${city}”. Check the spelling and try again.`);
    await loadPlace(matches[0]);
    elements.suggestions.classList.add("hidden");
  } catch (error) {
    if (version === requestVersion) {
      setLoading(false);
      showStatus(error.message || "City search failed. Please try again.", true, () => loadCity(city));
    }
  }
}

function currentHourIndex(data) {
  const times = data.hourly.time;
  const localNow = data.current.time;
  let index = times.findIndex((time) => time >= localNow);
  return index < 0 ? 0 : index;
}

function renderDashboard() {
  const current = currentWeather.current;
  const daily = currentWeather.daily;
  const info = weatherInfo(current.weather_code);
  $("#cityName").textContent = currentPlace.name || "Selected location";
  $("#countryName").textContent = [currentPlace.admin1, currentPlace.country].filter(Boolean).filter((value, index, list) => list.indexOf(value) === index).join(", ");
  $("#currentDate").textContent = new Date(current.time || Date.now()).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  $("#temperature").textContent = temperature(current.temperature_2m);
  $("#feelsLike").textContent = temperature(current.apparent_temperature);
  $("#weatherIcon").textContent = info[1];
  $("#weatherDescription").textContent = info[0];
  $("#humidity").textContent = formatValue(current.relative_humidity_2m, "%");
  $("#windSpeed").textContent = formatValue(current.wind_speed_10m, " km/h", 1);
  $("#precipitation").textContent = formatValue(current.precipitation, " mm", 1);
  $("#weatherHighlight").textContent = current.weather_code >= 51 && current.weather_code < 90 ? "Keep an umbrella within reach." : current.weather_code >= 95 ? "Stormy conditions: take care outdoors." : "A good moment to step outside.";
  $("#comfortTip").textContent = current.is_day ? "Forecast conditions are updated from your local weather model." : "Nighttime conditions in your local forecast.";
  document.body.dataset.weather = backgroundName(current.weather_code, current.is_day);
  renderSun(daily);
  renderUv(current.uv_index);
  renderAqi(currentAir);
  renderHourly(currentWeather);
  renderDaily(daily);
  renderRecommendations(currentWeather);
  renderAlerts(currentWeather);
  renderCharts(currentWeather);
  renderFavorites();
  renderRecent();
  updateFavoriteButton();
}

function backgroundName(code, isDay) {
  if (!isDay) return "night";
  if (code >= 95) return "storm";
  if (code >= 71 && code <= 86) return "snow";
  if (code >= 51 && code <= 67 || code >= 80 && code <= 82) return "rain";
  if (code >= 2) return "cloudy";
  return "clear";
}

function renderSun(daily) {
  const sunrise = daily.sunrise?.[0];
  const sunset = daily.sunset?.[0];
  if (!sunrise || !sunset) {
    $("#sunrise").textContent = $("#sunset").textContent = "--:--";
    $("#daylightDuration").textContent = "Sunrise and sunset data unavailable.";
    $("#daylightFill").style.width = "0%";
    return;
  }
  const riseDate = new Date(sunrise);
  const setDate = new Date(sunset);
  $("#sunrise").textContent = riseDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  $("#sunset").textContent = setDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const minutes = Math.max(0, Math.round((setDate - riseDate) / 60000));
  $("#daylightDuration").textContent = `Daylight lasts ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  const now = new Date(currentWeather.current.time);
  const elapsed = Math.max(0, Math.min(1, (now - riseDate) / (setDate - riseDate)));
  $("#daylightFill").style.width = `${Math.round(elapsed * 100)}%`;
}

function uvGuidance(value) {
  if (!Number.isFinite(value)) return ["—", "UV data unavailable", "UV forecast is not available for this location."];
  if (value < 3) return ["Low", "Low exposure", "Minimal protection is usually needed."];
  if (value < 6) return ["Moderate", "Moderate exposure", "Seek shade around midday and consider sunscreen."];
  if (value < 8) return ["High", "High exposure", "Use sunscreen, protective clothing and shade."];
  if (value < 11) return ["Very high", "Very high exposure", "Limit midday sun; use SPF, a hat and shade."];
  return ["Extreme", "Extreme exposure", "Avoid midday sun and use full sun protection."];
}

function renderUv(value) {
  const [risk, label, advice] = uvGuidance(value);
  $("#uvCurrent").textContent = Number.isFinite(value) ? value.toFixed(1) : "—";
  $("#uvCategory").textContent = label;
  $("#uvMeter").style.width = `${Math.min(100, Math.max(0, (Number(value) || 0) / 11 * 100))}%`;
  $("#uvCurrent").title = advice;
  $("#comfortTip").textContent = `${advice} ${currentWeather.current.is_day ? "Forecast conditions are updated from your local weather model." : "Nighttime conditions in your local forecast."}`;
}

function aqiGuidance(value) {
  if (!Number.isFinite(value)) return ["Unavailable", "Air-quality readings are currently unavailable."];
  if (value < 20) return ["Good", "Air quality is good; enjoy outdoor activities."];
  if (value < 40) return ["Fair", "Generally acceptable; unusually sensitive people may prefer lighter exertion."];
  if (value < 60) return ["Moderate", "Sensitive groups may want to reduce prolonged outdoor exertion."];
  if (value < 80) return ["Poor", "Consider reducing prolonged outdoor exertion, especially if sensitive."];
  return ["Very Poor", "Limit prolonged outdoor activity; sensitive groups should take extra care."];
}

function renderAqi(data) {
  const current = data?.current;
  const value = current?.european_aqi;
  const [category, advice] = aqiGuidance(value);
  $("#aqiValue").textContent = Number.isFinite(value) ? Math.round(value) : "—";
  $("#aqiCategory").textContent = category;
  $("#aqiAdvice").textContent = advice;
  $("#aqiMeter").style.width = `${Math.min(100, Math.max(0, (Number(value) || 0) / 100 * 100))}%`;
  $("#aqiMeter").title = `European AQI ${Number.isFinite(value) ? Math.round(value) : "unavailable"} on a 0–100+ scale`;
  $("#pm25").textContent = formatValue(current?.pm2_5, " μg/m³", 1);
  $("#pm10").textContent = formatValue(current?.pm10, " μg/m³", 1);
  $("#no2").textContent = formatValue(current?.nitrogen_dioxide, " μg/m³", 1);
  $("#ozone").textContent = formatValue(current?.ozone, " μg/m³", 1);
  if (!current) $("#aqiScale").textContent = "Air-quality API data could not be loaded. Weather forecasts remain available.";
}

function renderHourly(data) {
  const hourly = data.hourly;
  const start = currentHourIndex(data);
  elements.hourly.replaceChildren();
  for (let index = start; index < Math.min(start + 24, hourly.time.length); index += 1) {
    const card = document.createElement("article");
    card.className = "hour-card";
    const values = [
      [hourly.time[index].slice(11, 16), "hour-time"],
      [weatherInfo(hourly.weather_code[index])[1], "hour-icon"],
      [temperature(hourly.temperature_2m[index]), "hour-temp"],
      [`${formatValue(hourly.precipitation_probability?.[index], "%")} rain`, "hour-rain"],
      [`${formatValue(hourly.wind_speed_10m?.[index], " km/h", 0)} wind`, "hour-wind"]
    ];
    for (const [text, className] of values) {
      const item = document.createElement("div");
      item.className = className;
      item.textContent = text;
      card.append(item);
    }
    elements.hourly.append(card);
  }
  if (!elements.hourly.children.length) elements.hourly.textContent = "Hourly forecast unavailable.";
}

function renderDaily(daily) {
  elements.forecasts.replaceChildren();
  for (let index = 0; index < daily.time.length; index += 1) {
    const card = document.createElement("article");
    card.className = "forecast-card";
    const date = new Date(`${daily.time[index]}T12:00:00`);
    const day = index === 0 ? "Today" : date.toLocaleDateString(undefined, { weekday: "short" });
    const info = weatherInfo(daily.weather_code[index]);
    const dayElement = document.createElement("p");
    dayElement.className = "forecast-day";
    dayElement.textContent = day;
    const icon = document.createElement("div");
    icon.className = "forecast-icon";
    icon.textContent = info[1];
    icon.title = info[0];
    const condition = document.createElement("p");
    condition.className = "forecast-condition";
    condition.textContent = info[0];
    const temps = document.createElement("div");
    temps.className = "forecast-temps";
    const high = document.createElement("span");
    high.textContent = temperature(daily.temperature_2m_max[index]);
    const low = document.createElement("span");
    low.className = "low";
    low.textContent = temperature(daily.temperature_2m_min[index]);
    temps.append(high, low);
    card.append(dayElement, icon, condition, temps);
    elements.forecasts.append(card);
  }
}

function renderRecommendations(data) {
  const degrees = data.current.temperature_2m;
  let clothing = "Light layers should be comfortable.";
  if (degrees < 8) clothing = "Bundle up with a warm coat and insulating layers.";
  else if (degrees < 17) clothing = "A light jacket or a couple of comfortable layers should help.";
  else if (degrees > 30) clothing = "Choose breathable, light-colored clothing and take breaks in the shade.";
  $("#clothingTip").textContent = `${clothing} Current temperature: ${temperature(degrees)}.`;
  const start = currentHourIndex(data);
  const probabilities = data.hourly.precipitation_probability || [];
  const maxRainChance = Math.max(0, ...probabilities.slice(start, start + 12).filter(Number.isFinite));
  const rainyCode = data.hourly.weather_code.slice(start, start + 12).some((code) => code >= 51 && code <= 82);
  $("#rainTip").textContent = maxRainChance >= 40 || rainyCode
    ? `Rain may affect the next 12 hours (modelled peak chance ${maxRainChance}%). Consider carrying an umbrella.`
    : `No notable rain signal in the next 12 hours (modelled peak chance ${maxRainChance}%).`;
}

function renderAlerts(data) {
  const list = $("#alertsList");
  list.replaceChildren();
  const signals = [];
  const current = data.current;
  const start = currentHourIndex(data);
  const end = start + 24;
  const codes = data.hourly.weather_code.slice(start, end);
  const maxWind = Math.max(0, ...data.hourly.wind_speed_10m.slice(start, end).filter(Number.isFinite));
  const maxRainChance = Math.max(0, ...(data.hourly.precipitation_probability || []).slice(start, end).filter(Number.isFinite));
  const maxRain = Math.max(0, ...(data.hourly.precipitation || []).slice(start, end).filter(Number.isFinite));
  if (codes.some((code) => code >= 95)) signals.push("Thunderstorm codes appear in the next 24 hours. Follow local official guidance.");
  if (codes.some((code) => code >= 65 && code <= 82) || maxRainChance >= 70 || maxRain >= 5) signals.push(`Rainfall signal in the next 24 hours (peak chance ${maxRainChance}%, peak hourly amount ${maxRain.toFixed(1)} mm).`);
  if (maxWind >= 50) signals.push(`Strong wind signal: forecast wind reaches ${Math.round(maxWind)} km/h in the next 24 hours.`);
  if (current.weather_code >= 95) signals.push("Thunderstorm conditions are reported at the current forecast hour.");
  if (codes.some((code) => [75, 86, 96, 99].includes(code))) signals.push("Potentially severe snow or hail code appears in the forecast. Follow local official guidance.");
  if (signals.length) {
    for (const signal of [...new Set(signals)]) {
      const item = document.createElement("li");
      item.textContent = signal;
      list.append(item);
    }
  } else {
    const item = document.createElement("li");
    item.textContent = "No severe-weather signals detected in the available 24-hour forecast. Official alert feeds are not provided by this API.";
    list.append(item);
  }
}

function chartColor() {
  return getComputedStyle(document.documentElement).getPropertyValue("--primary").trim();
}

function makeChart(id, config) {
  if (typeof Chart === "undefined") return;
  if (charts[id]) charts[id].destroy();
  const color = chartColor();
  const textColor = getComputedStyle(document.documentElement).getPropertyValue("--muted").trim();
  config.options = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: textColor, usePointStyle: true, boxWidth: 7 } } },
    scales: {
      x: { ticks: { color: textColor, maxTicksLimit: 8 }, grid: { color: "transparent" } },
      y: { ticks: { color: textColor }, grid: { color: getComputedStyle(document.documentElement).getPropertyValue("--border").trim() } }
    },
    ...config.options
  };
  for (const dataset of config.data.datasets) {
    dataset.borderColor ||= color;
    dataset.backgroundColor ||= `${color}33`;
    dataset.tension = 0.35;
    dataset.pointRadius = 2;
  }
  charts[id] = new Chart($(`#${id}`), config);
}

function renderCharts(data) {
  if (typeof Chart === "undefined") {
    showStatus("Charts could not load. Check access to the Chart.js CDN.", true);
    return;
  }
  const hourly = data.hourly;
  const start = currentHourIndex(data);
  const indexes = Array.from({ length: Math.min(24, hourly.time.length - start) }, (_, index) => start + index);
  const labels = indexes.map((index) => hourly.time[index].slice(11, 16));
  const base = (values, label, unit, color) => ({
    type: "line",
    data: { labels, datasets: [{ label, data: indexes.map((index) => values[index]), borderColor: color, backgroundColor: `${color}33`, fill: true }] },
    options: { plugins: { tooltip: { callbacks: { label: (context) => `${context.dataset.label}: ${label === "Temperature" ? temperature(context.parsed.y) : `${context.parsed.y}${unit}`}` } } } }
  });
  makeChart("temperatureChart", base(hourly.temperature_2m, "Temperature", "", "#b9ef75"));
  const daily = data.daily;
  makeChart("weeklyChart", {
    type: "line",
    data: { labels: daily.time.map((date) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short" })),
      datasets: [
        { label: "High", data: daily.temperature_2m_max, borderColor: "#b9ef75", backgroundColor: "#b9ef7533" },
        { label: "Low", data: daily.temperature_2m_min, borderColor: "#d8bc83", backgroundColor: "#d8bc8333" }
      ] },
    options: { plugins: { tooltip: { callbacks: { label: (context) => `${context.dataset.label}: ${temperature(context.parsed.y)}` } } } }
  });
  makeChart("humidityChart", base(hourly.relative_humidity_2m, "Humidity", "%", "#8ec64f"));
  makeChart("windChart", base(hourly.wind_speed_10m, "Wind", " km/h", "#d8bc83"));
  // The API returns Celsius; chart axes and tooltips follow the selected display unit.
  if (charts.temperatureChart) {
    charts.temperatureChart.options.scales.y.ticks.callback = (value) => temperature(Number(value));
    charts.temperatureChart.update();
  }
  const weeklyChart = charts.weeklyChart;
  if (weeklyChart) {
    weeklyChart.options.scales.y.ticks.callback = (value) => temperature(Number(value));
    weeklyChart.update();
  }
}

function keyFor(place) {
  return `${place.name}|${place.admin1 || ""}|${place.country || ""}`.toLowerCase();
}

function persistPlaces(key, places) {
  saveStorage(key, places);
}

function addRecent(place) {
  const key = keyFor(place);
  recentPlaces = [place, ...recentPlaces.filter((item) => keyFor(item) !== key)].slice(0, 8);
  persistPlaces(STORAGE.recent, recentPlaces);
  renderRecent();
}

function renderFavorites() {
  renderCityList(elements.favorites, favoritePlaces, true);
  $("#favoritesEmpty").classList.toggle("hidden", favoritePlaces.length > 0);
}

function renderRecent() {
  renderCityList(elements.recent, recentPlaces, false);
  $("#recentEmpty").classList.toggle("hidden", recentPlaces.length > 0);
}

function renderCityList(container, places, removable) {
  container.replaceChildren();
  places.forEach((place) => {
    const chip = document.createElement("div");
    chip.className = "city-chip";
    const switchButton = document.createElement("button");
    switchButton.type = "button";
    switchButton.textContent = [place.name, place.admin1].filter(Boolean).join(", ");
    switchButton.title = `Show weather for ${place.name}`;
    switchButton.addEventListener("click", () => loadPlace(place));
    chip.append(switchButton);
    if (removable) {
      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "remove-city";
      removeButton.textContent = "×";
      removeButton.setAttribute("aria-label", `Remove ${place.name} from favourites`);
      removeButton.addEventListener("click", () => removeFavorite(place));
      chip.append(removeButton);
    }
    container.append(chip);
  });
}

function updateFavoriteButton() {
  const favorite = currentPlace && favoritePlaces.some((place) => keyFor(place) === keyFor(currentPlace));
  $("#favoriteBtn").textContent = favorite ? "★" : "☆";
  $("#favoriteBtn").setAttribute("aria-label", favorite ? "Remove city from favourites" : "Add city to favourites");
}

function toggleFavorite() {
  if (!currentPlace) return;
  const exists = favoritePlaces.some((place) => keyFor(place) === keyFor(currentPlace));
  favoritePlaces = exists ? favoritePlaces.filter((place) => keyFor(place) !== keyFor(currentPlace)) : [currentPlace, ...favoritePlaces].slice(0, 12);
  persistPlaces(STORAGE.favorites, favoritePlaces);
  renderFavorites();
  updateFavoriteButton();
}

function removeFavorite(place) {
  favoritePlaces = favoritePlaces.filter((item) => keyFor(item) !== keyFor(place));
  persistPlaces(STORAGE.favorites, favoritePlaces);
  renderFavorites();
  updateFavoriteButton();
}

function initializeTheme() {
  const stored = localStorage.getItem(STORAGE.theme);
  document.documentElement.dataset.theme = stored === "light" ? "light" : "dark";
  elements.theme.textContent = stored === "light" ? "☾" : "☼";
}

function toggleTheme() {
  const theme = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
  elements.theme.textContent = theme === "light" ? "☾" : "☼";
  try { localStorage.setItem(STORAGE.theme, theme); } catch (error) { console.warn("Could not save theme preference.", error); }
  if (currentWeather) renderCharts(currentWeather);
}

function initializeMap() {
  if (typeof L === "undefined" || map) return;
  map = L.map("weatherMap").setView([20, 0], 2);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);
}

function updateMap(place) {
  initializeMap();
  if (!map || !Number.isFinite(Number(place.latitude)) || !Number.isFinite(Number(place.longitude))) return;
  const id = keyFor(place);
  if (mapMarkers.has(id)) map.removeLayer(mapMarkers.get(id));
  const marker = L.marker([place.latitude, place.longitude]).addTo(map);
  const tooltip = document.createElement("span");
  tooltip.textContent = [place.name, place.admin1, place.country].filter(Boolean).join(", ");
  marker.bindTooltip(tooltip);
  marker.on("click", () => loadPlace(place));
  mapMarkers.set(id, marker);
  map.setView([place.latitude, place.longitude], 8);
  window.setTimeout(() => map?.invalidateSize(), 100);
}

async function refreshCurrent() {
  if (!currentPlace) return;
  if (activeRefresh) return activeRefresh;
  activeRefresh = loadPlace(currentPlace, { remember: false, refreshing: true }).finally(() => { activeRefresh = null; });
  return activeRefresh;
}

async function compareCities(names) {
  elements.compareResults.replaceChildren();
  if (names.length < 2) {
    showStatus("Enter at least two city names to compare.", true);
    return;
  }
  if (names.length > 5) {
    showStatus("Compare up to five cities at a time.", true);
    return;
  }
  showStatus("Loading city comparison…");
  const results = await Promise.allSettled(names.map(async (name) => {
    const places = await searchPlaces(name, 1);
    if (!places.length) throw new Error(`${name}: city not found`);
    const place = places[0];
    const weather = await fetchJson(weatherUrl(place.latitude, place.longitude), "Weather");
    return { place, current: weather.current };
  }));
  for (const result of results) {
    const card = document.createElement("article");
    card.className = "compare-card";
    if (result.status === "fulfilled") {
      const { place, current } = result.value;
      const title = document.createElement("h3");
      title.textContent = [place.name, place.country].filter(Boolean).join(", ");
      const temp = document.createElement("strong");
      temp.dataset.celsius = String(current.temperature_2m);
      temp.textContent = temperature(current.temperature_2m);
      const condition = document.createElement("p");
      condition.textContent = weatherInfo(current.weather_code)[0];
      const extra = document.createElement("p");
      extra.textContent = `Feels ${temperature(current.apparent_temperature)} · Wind ${formatValue(current.wind_speed_10m, " km/h", 0)}`;
      extra.dataset.apparent = String(current.apparent_temperature);
      extra.dataset.wind = String(current.wind_speed_10m);
      card.append(title, temp, condition, extra);
      card.addEventListener("click", (event) => {
        if (event.target === card || event.target === title || event.target === temp || event.target === condition || event.target === extra) loadPlace(place);
      });
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          loadPlace(place);
        }
      });
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.title = "Select this city";
    } else {
      const message = document.createElement("p");
      message.textContent = result.reason?.message || "Could not load this city.";
      card.append(message);
    }
    elements.compareResults.append(card);
  }
  hideStatus();
}

function shareCurrentWeather() {
  if (!currentPlace || !currentWeather) {
    showStatus("Load a city before sharing its weather.", true);
    return;
  }
  const current = currentWeather.current;
  const message = `${currentPlace.name}: ${temperature(current.temperature_2m)}, ${weatherInfo(current.weather_code)[0]} — Weatherly`;
  if (navigator.share) {
    navigator.share({ title: `Weather in ${currentPlace.name}`, text: message }).catch((error) => {
      if (error.name !== "AbortError") showStatus("Unable to share this weather right now.", true);
    });
    return;
  }
  if (!navigator.clipboard?.writeText) {
    showStatus("Sharing and clipboard access are unavailable in this browser.", true);
    return;
  }
  navigator.clipboard.writeText(message).then(() => showStatus("Weather summary copied to clipboard.")).catch(() => showStatus("Could not copy the weather summary. Try a secure browser context.", true));
}

function startVoiceSearch() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    showStatus("Voice search is not supported in this browser.", true);
    return;
  }
  const recognition = new Recognition();
  recognition.lang = navigator.language || "en-US";
  recognition.interimResults = false;
  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript.trim();
    elements.input.value = transcript;
    loadCity(transcript);
  };
  recognition.onerror = (event) => showStatus(`Voice search failed: ${event.error}.`, true);
  recognition.start();
}

function renderSuggestions(places) {
  elements.suggestions.replaceChildren();
  if (!places.length) {
    elements.suggestions.classList.add("hidden");
    return;
  }
  for (const place of places) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "option");
    button.textContent = [place.name, place.admin1, place.country].filter(Boolean).join(", ");
    button.addEventListener("click", () => {
      elements.input.value = button.textContent;
      elements.suggestions.classList.add("hidden");
      loadPlace(place);
    });
    item.append(button);
    elements.suggestions.append(item);
  }
  elements.suggestions.classList.remove("hidden");
}

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  loadCity(elements.input.value);
});
elements.input.addEventListener("input", () => {
  window.clearTimeout(suggestionTimer);
  const query = elements.input.value.trim();
  if (query.length < 2) {
    elements.suggestions.classList.add("hidden");
    return;
  }
  suggestionTimer = window.setTimeout(async () => {
    try { renderSuggestions(await searchPlaces(query, 5)); }
    catch (error) { console.warn("City suggestions unavailable.", error); }
  }, 300);
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".search-box")) elements.suggestions.classList.add("hidden");
});
elements.location.addEventListener("click", () => {
  if (!navigator.geolocation) {
    showStatus("Geolocation is not supported by this browser.", true);
    return;
  }
  const version = ++requestVersion;
  showStatus("Requesting permission to access your location…");
  setLoading(true);
  navigator.geolocation.getCurrentPosition(
    async ({ coords }) => {
      if (version !== requestVersion) return;
      const place = { name: "Your location", country: "Current location", latitude: coords.latitude, longitude: coords.longitude };
      await loadPlace(place);
    },
    (error) => {
      if (version !== requestVersion) return;
      const messages = { 1: "Location permission denied. Allow location access in browser settings and retry.", 2: "Your location is unavailable right now.", 3: "Location request timed out. Please try again." };
      setLoading(false);
      showStatus(messages[error.code] || "Unable to get your location.", true, () => elements.location.click());
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
  );
});
elements.unit.addEventListener("click", () => {
  isCelsius = !isCelsius;
  elements.unit.textContent = isCelsius ? "°C" : "°F";
  if (currentWeather) renderDashboard();
  elements.compareResults.querySelectorAll(".compare-card strong[data-celsius]").forEach((value) => {
    value.textContent = temperature(Number(value.dataset.celsius));
  });
  elements.compareResults.querySelectorAll(".compare-card p[data-apparent]").forEach((value) => {
    value.textContent = `Feels ${temperature(Number(value.dataset.apparent))} · Wind ${formatValue(Number(value.dataset.wind), " km/h", 0)}`;
  });
});
elements.theme.addEventListener("click", toggleTheme);
elements.refresh.addEventListener("click", refreshCurrent);
elements.interval.value = localStorage.getItem(STORAGE.interval) || "15";
elements.interval.addEventListener("change", () => {
  try { localStorage.setItem(STORAGE.interval, elements.interval.value); } catch (error) { console.warn("Could not save refresh interval.", error); }
});
window.setInterval(() => {
  const minutes = Number(elements.interval.value);
  if (minutes > 0 && currentPlace && !activeRefresh && Date.now() - lastRefreshTimestamp >= minutes * 60_000) refreshCurrent();
}, 60_000);
$("#favoriteBtn").addEventListener("click", toggleFavorite);
$("#clearHistoryBtn").addEventListener("click", () => {
  recentPlaces = [];
  persistPlaces(STORAGE.recent, recentPlaces);
  renderRecent();
});
elements.compareForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const names = elements.compareInput.value.split(",").map((name) => name.trim()).filter(Boolean);
  compareCities(names).catch((error) => showStatus(error.message || "Unable to compare cities.", true));
});
elements.share.addEventListener("click", shareCurrentWeather);
elements.voice.addEventListener("click", startVoiceSearch);
initializeTheme();
renderFavorites();
renderRecent();
loadCity("Nagpur");
