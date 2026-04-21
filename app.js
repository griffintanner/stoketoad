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
      <line x1="7" y1="7" x2="7" y2="1.5" stroke="#907830" stroke-width="1.5" stroke-linecap="round"/>
      <polyline points="4.5,4 7,1.5 9.5,4" fill="none" stroke="#907830" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <line x1="1" y1="9" x2="13" y2="9" stroke="#907830" stroke-width="1.5" stroke-linecap="round"/>
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
      <line x1="7" y1="1.5" x2="7" y2="7" stroke="#7A7060" stroke-width="1.5" stroke-linecap="round"/>
      <polyline points="4.5,4.5 7,7 9.5,4.5" fill="none" stroke="#7A7060" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <line x1="1" y1="9" x2="13" y2="9" stroke="#7A7060" stroke-width="1.5" stroke-linecap="round"/>
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
    <path d="M 9.6,3.2 A 6,6 0 1,1 12.7,12.7 A 5,5 0 0,1 9.6,3.2 Z" fill="#9A9690"/>
  </svg>`;
}

function weatherIcon(code, isDaytime) {
  // Clear sky at night → moon
  if (!isDaytime && (code === 0 || code === 1)) {
    return moonIcon();
  }

  if (code === 0 || code === 1) {
    return `<svg viewBox="0 0 18 18" fill="none">
      <circle cx="9" cy="9" r="3.5" stroke="#907830" stroke-width="1.5"/>
      <line x1="9" y1="1" x2="9" y2="3.2" stroke="#907830" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="9" y1="14.8" x2="9" y2="17" stroke="#907830" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="1" y1="9" x2="3.2" y2="9" stroke="#907830" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="14.8" y1="9" x2="17" y2="9" stroke="#907830" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="3.2" y1="3.2" x2="4.7" y2="4.7" stroke="#907830" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="13.3" y1="13.3" x2="14.8" y2="14.8" stroke="#907830" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="14.8" y1="3.2" x2="13.3" y2="4.7" stroke="#907830" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="4.7" y1="13.3" x2="3.2" y2="14.8" stroke="#907830" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`;
  }
  if (code === 2) {
    return `<svg viewBox="0 0 18 18" fill="none">
      <circle cx="6.5" cy="6.5" r="2.8" stroke="#907830" stroke-width="1.4"/>
      <line x1="6.5" y1="1" x2="6.5" y2="2.5" stroke="#907830" stroke-width="1.4" stroke-linecap="round"/>
      <line x1="1" y1="6.5" x2="2.5" y2="6.5" stroke="#907830" stroke-width="1.4" stroke-linecap="round"/>
      <line x1="2.8" y1="2.8" x2="3.8" y2="3.8" stroke="#907830" stroke-width="1.4" stroke-linecap="round"/>
      <ellipse cx="11" cy="12" rx="5.5" ry="3" fill="#9A9690"/>
      <ellipse cx="7.5" cy="13.5" rx="3.5" ry="2.5" fill="#9A9690"/>
    </svg>`;
  }
  if (code >= 95) {
    return `<svg viewBox="0 0 18 18" fill="none">
      <ellipse cx="9" cy="7" rx="6.5" ry="3.5" fill="#9A9690"/>
      <polyline points="9,10.5 7,14 9.5,14 7,17"
        fill="none" stroke="#907830" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) {
    return `<svg viewBox="0 0 18 18" fill="none">
      <ellipse cx="9" cy="7" rx="6.5" ry="3.5" fill="#9A9690"/>
      <line x1="5.5" y1="12" x2="4"   y2="16" stroke="#9A9690" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="9"   y1="12" x2="7.5" y2="16" stroke="#9A9690" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="12.5" y1="12" x2="11" y2="16" stroke="#9A9690" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`;
  }
  if (code >= 71 && code <= 77) {
    return `<svg viewBox="0 0 18 18" fill="none">
      <ellipse cx="9" cy="7" rx="6.5" ry="3.5" fill="#9A9690"/>
      <circle cx="5.5" cy="13.5" r="1.2" fill="#9A9690"/>
      <circle cx="9"   cy="15"   r="1.2" fill="#9A9690"/>
      <circle cx="12.5" cy="13.5" r="1.2" fill="#9A9690"/>
    </svg>`;
  }
  // Overcast / cloud
  return `<svg viewBox="0 0 18 18" fill="none">
    <ellipse cx="10" cy="9"  rx="6"   ry="3.5" fill="#9A9690"/>
    <ellipse cx="6"  cy="11" rx="4.5" ry="3"   fill="#9A9690"/>
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
    const nightClass = daytime ? '' : ' nighttime-hour';
    const row = document.createElement('div');
    row.className = 'forecast-row' + rowClass + nightClass;
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
  buildCliffs();
}

// Start on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// ═══════════════════════════════════════
// CLIFF GENERATION
// ═══════════════════════════════════════

// Seeded LCG — each column gets a unique, reproducible cliff.
function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function buildCliff(side, totalHeight) {
  const el = document.querySelector('.cliff-col--' + side);
  if (!el) return;

  const W = 120;
  const H = totalHeight;
  const rng = makeRng(side === 'left' ? 74328 : 192837);

  // ── Layer generation ──────────────────────────────────────────────────────
  //
  // `reach` = distance from the outer page edge to the cliff face for this layer.
  // Left col:  reach is the right-edge x of the rock mass.
  // Right col: reach is measured the same way; mirrored on draw.
  //
  // The Gunks profile: mostly sheer wall (reach ≈ baseReach) interrupted by
  // specific features — horizontal roofs, stepped ledges, shallow recesses.
  // Keeping wall sections dominant is what makes the occasional features read.

  const baseReach = 58 + rng() * 10;  // where the main wall face sits: 58–68 px

  const layers = [];
  let y = 0;

  while (y < H + 120) {
    const roll = rng();
    let reach, h, type;

    if (roll < 0.07) {
      // ── MAJOR ROOF ────────────────────────────────────────────────────────
      // The signature Gunks feature: a thin horizontal slab jutting out hard.
      // Thin layer so the overhang is dramatic and reads as a roof, not a ledge.
      type  = 'roof';
      h     = 12 + rng() * 18;                    // 12–30 px tall (thin)
      reach = baseReach + 28 + rng() * 24;         // 28–52 px beyond base

    } else if (roll < 0.16) {
      // ── STEPPED LEDGE ────────────────────────────────────────────────────
      // A moderate protrusion — creates the stepped horizontal bands Gunks
      // climbers use as footholds.
      type  = 'ledge';
      h     = 18 + rng() * 30;                    // 18–48 px
      reach = baseReach + 10 + rng() * 16;         // 10–26 px beyond base

    } else if (roll < 0.26) {
      // ── RECESS / NICHE ───────────────────────────────────────────────────
      // The wall pulls back — a hollow or solution pocket.
      type  = 'recess';
      h     = 20 + rng() * 40;                    // 20–60 px
      reach = baseReach - 12 - rng() * 18;         // 12–30 px behind base

    } else if (roll < 0.40) {
      // ── SLAB ─────────────────────────────────────────────────────────────
      // A taller, gently-angled wall section — slight protrusion over a long
      // height, like a low-angle face above a harder vertical.
      type  = 'slab';
      h     = 45 + rng() * 55;                    // 45–100 px (taller)
      reach = baseReach + 4 + rng() * 10;          // 4–14 px beyond base

    } else {
      // ── WALL (majority) ──────────────────────────────────────────────────
      // Plain sheer face. Small variation keeps it from looking rendered.
      type  = 'wall';
      h     = 22 + rng() * 55;                    // 22–77 px
      reach = baseReach + rng() * 10 - 5;          // ±5 px from base
    }

    reach = Math.max(16, Math.min(W - 4, reach));
    layers.push({ y, h, reach, type });
    y += h;
  }

  // ── Colors ────────────────────────────────────────────────────────────────
  // Pale Gunks quartzite: mostly warm light grey, with careful shading to
  // distinguish the vertical face, lit ledge tops, and shadowed undersides.

  const C_BODY        = '#C2BEB6';   // main rock body (pale warm grey)
  const C_FACE        = '#A8A4A0';   // vertical cliff face (slightly darker)
  const C_TOP         = '#D8D4CB';   // sunlit top of a ledge / roof
  const C_UNDER       = '#7C7874';   // underside of a roof (in deep shadow)
  const C_CRACK       = '#5E5A56';   // bedding-plane crack lines
  const C_ROOF_SHADOW = 'rgba(34,28,20,0.32)'; // shadow cast on wall below roof

  const parts = [];

  // Depth gradient: rock is darker at the outer wall (back of cliff) and
  // lightens toward the inner face — gives the impression of 3-D depth.
  const gradId = `rg-${side}`;
  if (side === 'left') {
    parts.push(
      `<defs><linearGradient id="${gradId}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${W}" y2="0">` +
      `<stop offset="0%"   stop-color="#8A8682"/>` +
      `<stop offset="45%"  stop-color="${C_BODY}"/>` +
      `<stop offset="100%" stop-color="${C_BODY}"/>` +
      `</linearGradient></defs>`
    );
  } else {
    parts.push(
      `<defs><linearGradient id="${gradId}" gradientUnits="userSpaceOnUse" x1="${W}" y1="0" x2="0" y2="0">` +
      `<stop offset="0%"   stop-color="#8A8682"/>` +
      `<stop offset="45%"  stop-color="${C_BODY}"/>` +
      `<stop offset="100%" stop-color="${C_BODY}"/>` +
      `</linearGradient></defs>`
    );
  }

  for (let i = 0; i < layers.length; i++) {
    const { y: ly, h: lh, reach: lr, type } = layers[i];
    const prevReach = i > 0 ? layers[i - 1].reach : lr;
    const nextReach = i + 1 < layers.length ? layers[i + 1].reach : lr;

    // Small per-layer roughness so the face edge isn't perfectly straight.
    // Roofs and ledges get less roughness — they're hard, well-defined rock.
    const roughScale = (type === 'roof' || type === 'ledge') ? 1.5 : 3.5;
    const topEdge = Math.max(8, lr + rng() * roughScale - roughScale / 2);
    const botEdge = Math.max(8, lr + rng() * roughScale - roughScale / 2);

    // Crack weight varies by feature type — roofs and ledges have prominent
    // bedding planes (they're defined by them), walls have finer cracks.
    const crackW = (type === 'roof' || type === 'ledge')
      ? 1.4 + rng() * 0.8
      : 0.5 + rng() * 0.7;
    const crackOpacity = 0.45 + rng() * 0.35;

    if (side === 'left') {

      // 1 · Rock body
      parts.push(
        `<polygon points="0,${ly} ${topEdge},${ly} ${botEdge},${ly+lh} 0,${ly+lh}" fill="url(#${gradId})"/>`
      );

      // 2 · Cliff face — thin darker strip on the inner edge
      const faceW = (type === 'roof') ? 5 + rng() * 4 : 3 + rng() * 4;
      const faceTop = Math.max(0, topEdge - faceW);
      const faceBot = Math.max(0, botEdge - faceW);
      parts.push(
        `<polygon points="${faceTop},${ly} ${topEdge},${ly} ${botEdge},${ly+lh} ${faceBot},${ly+lh}" fill="${C_FACE}" opacity="0.55"/>`
      );

      // 3 · Lit top surface — visible only when this layer protrudes past the one above
      if (lr > prevReach + 5) {
        const topW = Math.max(0, topEdge - prevReach);
        parts.push(
          `<rect x="${prevReach}" y="${ly}" width="${topW}" height="${type === 'roof' ? 3 : 4}" fill="${C_TOP}" opacity="0.88"/>`
        );
      }

      // 4 · Overhang underside — when this layer protrudes past the one BELOW it
      if (lr > nextReach + 10) {
        const ohW = Math.max(0, botEdge - nextReach);
        // Dark horizontal underside of the overhang
        parts.push(
          `<rect x="${nextReach}" y="${ly + lh - 5}" width="${ohW}" height="5" fill="${C_UNDER}" opacity="0.88"/>`
        );
        // Shadow cast down onto the wall below
        const shadowH = Math.min(lh * 0.6, 18);
        parts.push(
          `<rect x="${nextReach}" y="${ly + lh}" width="${ohW}" height="${shadowH}" fill="${C_ROOF_SHADOW}"/>`
        );
      }

      // 5 · Bedding-plane crack at the top of this layer
      const crackMaxX = Math.max(topEdge, prevReach) + 1;
      parts.push(
        `<line x1="0" y1="${ly}" x2="${crackMaxX}" y2="${ly}" stroke="${C_CRACK}" stroke-width="${crackW}" opacity="${crackOpacity}"/>`
      );

    } else {

      // Right column: mirror — rock fills from (W − reach) to W.
      const tl = W - topEdge;   // cliff face inner x (top of layer)
      const bl = W - botEdge;   // cliff face inner x (bottom of layer)
      const pl = W - prevReach;
      const nl = W - nextReach;

      // 1 · Rock body
      parts.push(
        `<polygon points="${tl},${ly} ${W},${ly} ${W},${ly+lh} ${bl},${ly+lh}" fill="url(#${gradId})"/>`
      );

      // 2 · Cliff face
      const faceW = (type === 'roof') ? 5 + rng() * 4 : 3 + rng() * 4;
      parts.push(
        `<polygon points="${tl},${ly} ${tl+faceW},${ly} ${bl+faceW},${ly+lh} ${bl},${ly+lh}" fill="${C_FACE}" opacity="0.55"/>`
      );

      // 3 · Lit top surface
      if (lr > prevReach + 5) {
        const topW = Math.max(0, pl - tl);
        parts.push(
          `<rect x="${tl}" y="${ly}" width="${topW}" height="${type === 'roof' ? 3 : 4}" fill="${C_TOP}" opacity="0.88"/>`
        );
      }

      // 4 · Overhang underside
      if (lr > nextReach + 10) {
        const ohW = Math.max(0, nl - tl);
        parts.push(
          `<rect x="${tl}" y="${ly + lh - 5}" width="${ohW}" height="5" fill="${C_UNDER}" opacity="0.88"/>`
        );
        const shadowH = Math.min(lh * 0.6, 18);
        parts.push(
          `<rect x="${tl}" y="${ly + lh}" width="${ohW}" height="${shadowH}" fill="${C_ROOF_SHADOW}"/>`
        );
      }

      // 5 · Bedding-plane crack
      const crackMinX = Math.min(tl, pl) - 1;
      parts.push(
        `<line x1="${Math.max(0, crackMinX)}" y1="${ly}" x2="${W}" y2="${ly}" stroke="${C_CRACK}" stroke-width="${crackW}" opacity="${crackOpacity}"/>`
      );
    }
  }

  // ── Conglomerate pebbles ──────────────────────────────────────────────────
  // Gunks quartzite is a conglomerate — embedded rounded pebbles are visible
  // on the cliff face. Scatter them at low opacity inside the rock body.
  for (let i = 0, n = Math.ceil(H / 10); i < n; i++) {
    const px  = rng() * 95;
    const py  = rng() * H;
    const pr  = 1.0 + rng() * 2.0;
    const lay = layers.find(l => py >= l.y && py < l.y + l.h);
    if (!lay) continue;
    if (side === 'left' && px < lay.reach - 5) {
      parts.push(`<circle cx="${px}" cy="${py}" r="${pr}" fill="rgba(0,0,0,0.048)"/>`);
    } else if (side === 'right') {
      const rx = W - px;
      if (rx > W - lay.reach + 5) {
        parts.push(`<circle cx="${rx}" cy="${py}" r="${pr}" fill="rgba(0,0,0,0.048)"/>`);
      }
    }
  }

  // ── Vertical cracks ───────────────────────────────────────────────────────
  // Joint cracks run roughly vertically, wobbling slightly. Denser than
  // horizontal bedding planes, but thinner and fainter.
  for (let i = 0, n = Math.ceil(H / 80); i < n; i++) {
    const cx  = 4 + rng() * 70;
    const cy  = rng() * H;
    const ch  = 25 + rng() * 90;
    const wob = rng() * 8 - 4;
    const ax  = side === 'left' ? cx : W - cx;
    // Only draw if the crack stays within the rock body at its starting layer
    const lay = layers.find(l => cy >= l.y && cy < l.y + l.h);
    if (!lay) continue;
    const inRock = side === 'left' ? ax < lay.reach - 2 : ax > W - lay.reach + 2;
    if (!inRock) continue;
    parts.push(
      `<path d="M${ax},${cy} C${ax+wob*0.3},${cy+ch*0.3} ${ax+wob*0.7},${cy+ch*0.7} ${ax+wob},${cy+ch}" ` +
      `stroke="${C_CRACK}" stroke-width="${0.4 + rng() * 0.7}" fill="none" opacity="${0.28 + rng() * 0.32}"/>`
    );
  }

  el.innerHTML =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="display:block">` +
    parts.join('') +
    `</svg>`;
}

function buildCliffs() {
  if (window.innerWidth <= 840) return;
  const h = Math.max(document.body.scrollHeight, window.innerHeight, 2000);
  buildCliff('left',  h);
  buildCliff('right', h);
}

// ═══════════════════════════════════════
// HOPPING TOAD ANIMATION
// ═══════════════════════════════════════

const TOAD_SVG = `<svg viewBox="0 0 58 48" width="58" height="48" xmlns="http://www.w3.org/2000/svg">
  <!-- body (wide and squat — toad, not frog) -->
  <ellipse cx="29" cy="35" rx="21" ry="13" fill="#8A9E6A" stroke="#3E5230" stroke-width="1.5"/>
  <!-- head -->
  <ellipse cx="29" cy="22" rx="15" ry="11" fill="#8A9E6A" stroke="#3E5230" stroke-width="1.5"/>
  <!-- eye bumps -->
  <circle cx="19" cy="14" r="5.5" fill="#8A9E6A" stroke="#3E5230" stroke-width="1.5"/>
  <circle cx="39" cy="14" r="5.5" fill="#8A9E6A" stroke="#3E5230" stroke-width="1.5"/>
  <!-- pupils (horizontal oval — classic toad eye) -->
  <ellipse cx="19" cy="13" rx="3.5" ry="2.5" fill="#1A1408"/>
  <ellipse cx="39" cy="13" rx="3.5" ry="2.5" fill="#1A1408"/>
  <!-- eye shine -->
  <circle cx="20.5" cy="11.5" r="1.2" fill="white" opacity="0.7"/>
  <circle cx="40.5" cy="11.5" r="1.2" fill="white" opacity="0.7"/>
  <!-- smile -->
  <path d="M19,27 Q29,33 39,27" stroke="#3E5230" stroke-width="1.5" fill="none" stroke-linecap="round"/>
  <!-- warts -->
  <circle cx="18" cy="37" r="2"   fill="#7A8E5A" stroke="#3E5230" stroke-width="1"/>
  <circle cx="36" cy="32" r="1.8" fill="#7A8E5A" stroke="#3E5230" stroke-width="1"/>
  <circle cx="44" cy="40" r="2"   fill="#7A8E5A" stroke="#3E5230" stroke-width="1"/>
  <circle cx="28" cy="42" r="1.5" fill="#7A8E5A" stroke="#3E5230" stroke-width="0.8"/>
  <!-- belly highlight -->
  <ellipse cx="29" cy="37" rx="14" ry="8" fill="rgba(200,215,165,0.3)"/>
  <!-- front legs -->
  <path d="M10,35 Q5,40 3,45"  stroke="#3E5230" stroke-width="2" fill="none" stroke-linecap="round"/>
  <path d="M48,35 Q53,40 55,45" stroke="#3E5230" stroke-width="2" fill="none" stroke-linecap="round"/>
  <!-- back legs (spread for hopping) -->
  <path d="M13,43 Q7,46 3,47 M3,47 L0,45 M3,47 L1,49"   stroke="#3E5230" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M45,43 Q51,46 55,47 M55,47 L58,45 M55,47 L57,49" stroke="#3E5230" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

function spawnToad() {
  const goRight = Math.random() > 0.5;
  const yVh = 20 + Math.random() * 50; // 20–70% down the viewport

  // Outer wrapper: handles translateX (no scale). Fixed position.
  const wrapper = document.createElement('div');
  wrapper.className = 'hopping-toad';
  wrapper.style.top = yVh + 'vh';

  // Inner element: handles scaleX flip so the toad faces the right direction
  const inner = document.createElement('div');
  inner.innerHTML = TOAD_SVG;
  if (!goRight) inner.style.transform = 'scaleX(-1)';
  wrapper.appendChild(inner);
  document.body.appendChild(wrapper);

  const vw = window.innerWidth;
  const startX = goRight ? -70 : vw + 10;
  const endX   = goRight ? vw + 10 : -70;
  const hops   = 4;
  const hopH   = 30; // pixels up per hop

  // Build keyframes: touch-down → peak → touch-down for each hop
  const frames = [];
  for (let i = 0; i < hops; i++) {
    const t0 = i / hops;
    const t1 = (i + 0.5) / hops;
    const x0 = startX + (endX - startX) * t0;
    const xM = startX + (endX - startX) * t1;
    frames.push({ transform: `translateX(${x0}px) translateY(0px)`,        offset: t0 });
    frames.push({ transform: `translateX(${xM}px) translateY(-${hopH}px)`, offset: t1 });
  }
  frames.push({ transform: `translateX(${endX}px) translateY(0px)`, offset: 1 });

  const anim = wrapper.animate(frames, { duration: 3800, easing: 'linear' });
  anim.onfinish = () => wrapper.remove();
}

// First toad after 2 seconds, then one every 10 seconds
setTimeout(spawnToad, 2000);
setInterval(spawnToad, 10000);
