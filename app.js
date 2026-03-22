/*
  STOKE TOAD — app.js
  Gunks climbing conditions via Open-Meteo weather API.
*/

'use strict';

// ═══════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════

const API_URL =
  'https://api.open-meteo.com/v1/forecast' +
  '?latitude=41.7348&longitude=-74.1870' +
  '&daily=precipitation_sum,windspeed_10m_max,weathercode,temperature_2m_max,temperature_2m_min,sunrise,sunset' +
  '&hourly=temperature_2m,precipitation_probability,windspeed_10m,weathercode' +
  '&timezone=America%2FNew_York';

const CACHE_KEY = 'stoketoad_weather_v3';
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

// ═══════════════════════════════════════
// WEATHER API + CACHE
// ═══════════════════════════════════════

async function fetchWeather() {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const { data, ts } = JSON.parse(cached);
      if (Date.now() - ts < CACHE_TTL) return data;
    }
  } catch (_) { /* ignore parse errors */ }

  const resp = await fetch(API_URL);
  if (!resp.ok) throw new Error(`Weather fetch failed: ${resp.status}`);
  const data = await resp.json();

  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now() }));
  } catch (_) { /* storage might be full */ }

  return data;
}

function getTodayIndex(daily) {
  const today = new Date().toISOString().split('T')[0];
  return daily.time.indexOf(today);
}

// ═══════════════════════════════════════
// UNIT HELPERS
// ═══════════════════════════════════════

function cToF(c) {
  return Math.round(c * 9 / 5 + 32);
}

function kphToMph(kph) {
  return Math.round(kph * 0.621371);
}

// ═══════════════════════════════════════
// WEATHER LOGIC
// ═══════════════════════════════════════

function wmoDescription(code) {
  if (code === 0)    return 'Clear sky';
  if (code <= 2)     return 'Mostly clear';
  if (code === 3)    return 'Overcast';
  if (code <= 48)    return 'Fog';
  if (code <= 55)    return 'Drizzle';
  if (code <= 57)    return 'Freezing drizzle';
  if (code <= 63)    return 'Rain';
  if (code <= 67)    return 'Heavy rain';
  if (code <= 77)    return 'Snow';
  if (code <= 82)    return 'Rain showers';
  if (code <= 86)    return 'Snow showers';
  if (code >= 95)    return 'Thunderstorms';
  return 'Unknown';
}

function isGoodToClimb(daily, idx) {
  if (idx < 0) return { good: false, reason: 'Forecast unavailable' };

  const precip  = daily.precipitation_sum[idx];  // mm
  const wind    = daily.windspeed_10m_max[idx];   // km/h
  const code    = daily.weathercode[idx];
  const tempMax = daily.temperature_2m_max[idx];  // °C
  const windMph = wind * 0.621371;

  if (tempMax <= 0)                     return { good: false, reason: 'Below freezing' };
  if (code >= 95)                       return { good: false, reason: 'Thunderstorms incoming' };
  if ([65,66,67,82].includes(code))     return { good: false, reason: 'Heavy rain expected' };
  if (precip >= 2)                      return { good: false, reason: 'Rain expected' };
  if (windMph >= 25)                    return { good: false, reason: `Too windy (${Math.round(windMph)} mph)` };

  return { good: true };
}

function buildWeatherSummary(daily, idx) {
  if (idx < 0) return '';
  const hi   = cToF(daily.temperature_2m_max[idx]);
  const lo   = cToF(daily.temperature_2m_min[idx]);
  const w    = kphToMph(daily.windspeed_10m_max[idx]);
  const p    = daily.precipitation_sum[idx].toFixed(1);
  const desc = wmoDescription(daily.weathercode[idx]);
  return `${desc} · ${lo}–${hi}°F · Wind ${w} mph · Precip ${p} mm`;
}

// ═══════════════════════════════════════
// SUN TIME HELPERS
// ═══════════════════════════════════════

// Build a date-keyed map of { sunrise, sunset } ISO strings from daily data
function buildSunTimes(data) {
  const map = {};
  if (!data.daily.sunrise) return map;
  data.daily.time.forEach((date, i) => {
    map[date] = { sunrise: data.daily.sunrise[i], sunset: data.daily.sunset[i] };
  });
  return map;
}

// Is the hourly slot (e.g. "2026-03-22T14:00") during daylight?
function isSlotDaytime(timeStr, sunTimes) {
  const date = timeStr.split('T')[0];
  const times = sunTimes[date];
  if (!times) return true; // assume day if unknown
  // ISO string comparison works because format is consistent
  return timeStr >= times.sunrise && timeStr < times.sunset;
}

// "2026-03-22T06:23" → "6:23 AM"
function formatSunTime(isoStr) {
  const [hStr, mStr] = isoStr.split('T')[1].split(':');
  const h = parseInt(hStr, 10);
  return `${h === 0 ? 12 : h > 12 ? h - 12 : h}:${mStr} ${h < 12 ? 'AM' : 'PM'}`;
}

function insertSunriseRow(container, isoTime) {
  const el = document.createElement('div');
  el.className = 'forecast-sun-event forecast-sun-event--rise';
  el.innerHTML = `
    <svg viewBox="0 0 14 10" fill="none" width="14" height="10">
      <line x1="7" y1="7" x2="7" y2="1.5" stroke="#D4A017" stroke-width="1.5" stroke-linecap="round"/>
      <polyline points="4.5,4 7,1.5 9.5,4" fill="none" stroke="#D4A017" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <line x1="1" y1="9" x2="13" y2="9" stroke="#D4A017" stroke-width="1.5" stroke-linecap="round"/>
    </svg>
    <span>Sunrise &mdash; ${formatSunTime(isoTime)}</span>
  `;
  container.appendChild(el);
}

function insertSunsetRow(container, isoTime) {
  const el = document.createElement('div');
  el.className = 'forecast-sun-event forecast-sun-event--set';
  el.innerHTML = `
    <svg viewBox="0 0 14 10" fill="none" width="14" height="10">
      <line x1="7" y1="1.5" x2="7" y2="7" stroke="#8B8B8B" stroke-width="1.5" stroke-linecap="round"/>
      <polyline points="4.5,4.5 7,7 9.5,4.5" fill="none" stroke="#8B8B8B" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <line x1="1" y1="9" x2="13" y2="9" stroke="#8B8B8B" stroke-width="1.5" stroke-linecap="round"/>
    </svg>
    <span>Sunset &mdash; ${formatSunTime(isoTime)}</span>
  `;
  container.appendChild(el);
}

// ═══════════════════════════════════════
// FORECAST ICONS (minimal line-style SVG)
// ═══════════════════════════════════════

// Crescent moon — computed from two overlapping circles (outer r=6 center (8,9),
// inner r=5 center (11,8)). Path traces outer arc then inner concave arc.
function moonIcon() {
  return `<svg viewBox="0 0 18 18" fill="none">
    <path d="M 9.6,3.2 A 6,6 0 1,1 12.7,12.7 A 5,5 0 0,1 9.6,3.2 Z" fill="#A0A0A0"/>
  </svg>`;
}

function weatherIcon(code, isDaytime) {
  // Clear sky at night → moon
  if (!isDaytime && (code === 0 || code === 1)) {
    return moonIcon();
  }

  if (code === 0 || code === 1) {
    return `<svg viewBox="0 0 18 18" fill="none">
      <circle cx="9" cy="9" r="3.5" stroke="#D4A017" stroke-width="1.5"/>
      <line x1="9" y1="1" x2="9" y2="3.2" stroke="#D4A017" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="9" y1="14.8" x2="9" y2="17" stroke="#D4A017" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="1" y1="9" x2="3.2" y2="9" stroke="#D4A017" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="14.8" y1="9" x2="17" y2="9" stroke="#D4A017" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="3.2" y1="3.2" x2="4.7" y2="4.7" stroke="#D4A017" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="13.3" y1="13.3" x2="14.8" y2="14.8" stroke="#D4A017" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="14.8" y1="3.2" x2="13.3" y2="4.7" stroke="#D4A017" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="4.7" y1="13.3" x2="3.2" y2="14.8" stroke="#D4A017" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`;
  }
  if (code === 2) {
    return `<svg viewBox="0 0 18 18" fill="none">
      <circle cx="6.5" cy="6.5" r="2.8" stroke="#D4A017" stroke-width="1.4"/>
      <line x1="6.5" y1="1" x2="6.5" y2="2.5" stroke="#D4A017" stroke-width="1.4" stroke-linecap="round"/>
      <line x1="1" y1="6.5" x2="2.5" y2="6.5" stroke="#D4A017" stroke-width="1.4" stroke-linecap="round"/>
      <line x1="2.8" y1="2.8" x2="3.8" y2="3.8" stroke="#D4A017" stroke-width="1.4" stroke-linecap="round"/>
      <ellipse cx="11" cy="12" rx="5.5" ry="3" fill="#A0A0A0"/>
      <ellipse cx="7.5" cy="13.5" rx="3.5" ry="2.5" fill="#A0A0A0"/>
    </svg>`;
  }
  if (code >= 95) {
    return `<svg viewBox="0 0 18 18" fill="none">
      <ellipse cx="9" cy="7" rx="6.5" ry="3.5" fill="#A0A0A0"/>
      <polyline points="9,10.5 7,14 9.5,14 7,17"
        fill="none" stroke="#D4A017" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) {
    return `<svg viewBox="0 0 18 18" fill="none">
      <ellipse cx="9" cy="7" rx="6.5" ry="3.5" fill="#A0A0A0"/>
      <line x1="5.5" y1="12" x2="4"   y2="16" stroke="#A0A0A0" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="9"   y1="12" x2="7.5" y2="16" stroke="#A0A0A0" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="12.5" y1="12" x2="11" y2="16" stroke="#A0A0A0" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`;
  }
  if (code >= 71 && code <= 77) {
    return `<svg viewBox="0 0 18 18" fill="none">
      <ellipse cx="9" cy="7" rx="6.5" ry="3.5" fill="#A0A0A0"/>
      <circle cx="5.5" cy="13.5" r="1.2" fill="#A0A0A0"/>
      <circle cx="9"   cy="15"   r="1.2" fill="#A0A0A0"/>
      <circle cx="12.5" cy="13.5" r="1.2" fill="#A0A0A0"/>
    </svg>`;
  }
  // Overcast / cloud
  return `<svg viewBox="0 0 18 18" fill="none">
    <ellipse cx="10" cy="9"  rx="6"   ry="3.5" fill="#A0A0A0"/>
    <ellipse cx="6"  cy="11" rx="4.5" ry="3"   fill="#A0A0A0"/>
  </svg>`;
}

// ═══════════════════════════════════════
// HOURLY FORECAST — next 48 hours
// ═══════════════════════════════════════

function formatHourLabel(hour) {
  if (hour === 0)  return '12 AM';
  if (hour < 12)   return `${hour} AM`;
  if (hour === 12) return '12 PM';
  return `${hour - 12} PM`;
}

function formatDayLabel(dateStr) {
  const d = new Date(dateStr + 'T12:00:00'); // noon avoids DST edge cases
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

function buildHourlyForecast(data) {
  const container = document.getElementById('hourly-forecast');
  container.innerHTML = '';

  const now = new Date();
  const localDate = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
  const currentSlot = `${localDate}T${String(now.getHours()).padStart(2, '0')}:00`;

  const { hourly } = data;
  const sunTimes   = buildSunTimes(data);

  const startIdx = hourly.time.indexOf(currentSlot);
  if (startIdx === -1) return;

  let lastDate    = null;
  let prevDaytime = null;
  let prevTimeStr = null;

  for (let i = startIdx; i < startIdx + 48 && i < hourly.time.length; i++) {
    const timeStr = hourly.time[i];
    const [date, timePart] = timeStr.split('T');
    const hour    = parseInt(timePart, 10);
    const daytime = isSlotDaytime(timeStr, sunTimes);

    // Detect sunrise / sunset transitions and insert marker rows
    if (prevDaytime !== null && prevDaytime !== daytime) {
      const st = sunTimes[date];
      if (daytime && st) {
        // Night → Day: sunrise occurred before this slot
        insertSunriseRow(container, st.sunrise);
      } else if (!daytime && st) {
        // Day → Night: sunset occurred before this slot
        insertSunsetRow(container, st.sunset);
      }
    }

    // Day label when the calendar date rolls over
    if (date !== lastDate) {
      const dayEl = document.createElement('div');
      dayEl.className = 'forecast-day-label';
      dayEl.textContent = formatDayLabel(date);
      container.appendChild(dayEl);
      lastDate = date;
    }

    const tempF     = cToF(hourly.temperature_2m[i]);
    const precipPct = hourly.precipitation_probability[i] ?? 0;
    const windMph   = kphToMph(hourly.windspeed_10m[i]);
    const code      = hourly.weathercode[i];

    const isIdeal = code <= 2 && precipPct <= 5  && windMph < 15 && tempF > 38;
    const isBad   = precipPct > 20 || code >= 95 || [65,66,67,82].includes(code) || windMph >= 25 || tempF <= 32;

    const rowClass = isIdeal ? ' ideal-conditions' : isBad ? ' bad-conditions' : ' okay-conditions';
    const row = document.createElement('div');
    row.className = 'forecast-row' + rowClass;
    row.setAttribute('role', 'listitem');
    row.innerHTML = `
      <span class="forecast-time">${formatHourLabel(hour)}</span>
      <span class="forecast-icon">${weatherIcon(code, daytime)}</span>
      <span class="forecast-temp">${tempF}°F</span>
      <span class="forecast-precip">${precipPct}%</span>
      <span class="forecast-wind">${windMph} mph</span>
    `;
    container.appendChild(row);

    prevDaytime = daytime;
    prevTimeStr = timeStr;
  }
}

// ═══════════════════════════════════════
// UI
// ═══════════════════════════════════════

function showMessage(main, tomorrow, summary) {
  const msgEl = document.getElementById('main-message');
  const tomEl = document.getElementById('tomorrow-message');
  const sumEl = document.getElementById('weather-summary');
  msgEl.textContent = main;
  tomEl.textContent = tomorrow;
  sumEl.textContent = summary;
  // Trigger reflow so transitions fire
  msgEl.offsetHeight; // eslint-disable-line no-unused-expressions
  msgEl.classList.add('visible');
  tomEl.classList.add('visible');
  sumEl.classList.add('visible');
}

function showForecast() {
  const fc = document.getElementById('forecast-container');
  fc.removeAttribute('aria-hidden');
  fc.classList.add('visible');
}

// ═══════════════════════════════════════
// MAIN INIT
// ═══════════════════════════════════════

async function init() {
  const msgEl = document.getElementById('main-message');
  msgEl.textContent = 'Checking the forecast…';
  msgEl.style.opacity = '0.4';
  msgEl.style.fontFamily = 'Inter, sans-serif';
  msgEl.style.fontSize = '1rem';

  let data;
  try {
    data = await fetchWeather();
  } catch (err) {
    msgEl.textContent = 'Could not load forecast. Check your connection.';
    msgEl.style.opacity = '1';
    console.error(err);
    return;
  }

  // Reset loading styles before fade-in
  msgEl.textContent = '';
  msgEl.style.opacity = '';
  msgEl.style.fontFamily = '';
  msgEl.style.fontSize = '';

  const todayIdx         = getTodayIndex(data.daily);
  const { good, reason } = isGoodToClimb(data.daily, todayIdx);
  const summary          = buildWeatherSummary(data.daily, todayIdx);

  const tomorrowIdx     = todayIdx + 1;
  const tomorrowResult  = isGoodToClimb(data.daily, tomorrowIdx);
  const tomorrowLine    = tomorrowResult.good ? 'Tomorrow is looking good.' : 'Not tomorrow either.';

  if (good) {
    showMessage('Cough up the stoke toad and get to The Gunks.', tomorrowLine, summary);
  } else {
    showMessage('Not Today. Go do something else.', tomorrowLine, reason + (summary ? ' · ' + summary : ''));
  }

  buildHourlyForecast(data);
  showForecast();
}

// Start on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
