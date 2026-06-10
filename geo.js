/**
 * Geo — No API needed.
 * Built-in coordinates for Tamil Nadu + Puducherry areas and hospitals.
 * Haversine distance calculation.
 */

// ── Puducherry area coordinates ───────────────────────────────────────────────
const AREA_COORDS = {
  // Puducherry
  'White Town':           { lat: 11.9350, lon: 79.8350 },
  'Ariyankuppam':         { lat: 11.9103, lon: 79.8448 },
  'Villianur':            { lat: 11.9567, lon: 79.7736 },
  'Bahour':               { lat: 11.8900, lon: 79.7800 },
  'Nettapakkam':          { lat: 11.9800, lon: 79.7500 },
  'Odiyan':               { lat: 11.9500, lon: 79.8300 },
  'Mudaliarpet':          { lat: 11.9700, lon: 79.8200 },
  'Lawspet':              { lat: 11.9600, lon: 79.8100 },
  'Reddiarpalayam':       { lat: 11.9300, lon: 79.8000 },
  'Cuddalore Road':       { lat: 11.9250, lon: 79.8150 },
  'Anna Nagar, Pondicherry': { lat: 11.9480, lon: 79.8220 },
  'Ozhukarai':            { lat: 11.9650, lon: 79.8250 },
  'Mannadipet':           { lat: 11.9900, lon: 79.7800 },
  'Chunnambar':           { lat: 11.8850, lon: 79.8520 },
  'Karuvadikuppam':       { lat: 11.9150, lon: 79.8380 },
  'Kalapet':              { lat: 11.9720, lon: 79.8320 },
  'Kamaraj Nagar':        { lat: 11.9450, lon: 79.8250 },
  'Gorimedu':             { lat: 11.9420, lon: 79.8050 },
  'Thattanchavady':       { lat: 11.9650, lon: 79.8150 },
  'Kosapalayam':          { lat: 11.9200, lon: 79.8400 },
  'Thengazhithittu':      { lat: 11.8900, lon: 79.8500 },
  'Pondicherry':          { lat: 11.9416, lon: 79.8083 },
  'Puducherry':           { lat: 11.9416, lon: 79.8083 },

  // Chennai
  'Adyar, Chennai':       { lat: 13.0012, lon: 80.2565 },
  'Anna Nagar, Chennai':  { lat: 13.0850, lon: 80.2101 },
  'T. Nagar, Chennai':    { lat: 13.0418, lon: 80.2341 },
  'Velachery, Chennai':   { lat: 12.9815, lon: 80.2176 },
  'Tambaram, Chennai':    { lat: 12.9249, lon: 80.1000 },
  'Chromepet, Chennai':   { lat: 12.9516, lon: 80.1462 },
  'Porur, Chennai':       { lat: 13.0356, lon: 80.1567 },
  'Guindy, Chennai':      { lat: 13.0067, lon: 80.2206 },
  'Kodambakkam, Chennai': { lat: 13.0524, lon: 80.2254 },
  'Nungambakkam, Chennai':{ lat: 13.0569, lon: 80.2425 },
  'Perambur, Chennai':    { lat: 13.1154, lon: 80.2332 },
  'Mylapore, Chennai':    { lat: 13.0368, lon: 80.2676 },
  'Sholinganallur, Chennai': { lat: 12.9010, lon: 80.2279 },
  'Ambattur, Chennai':    { lat: 13.1143, lon: 80.1548 },
  'Avadi, Chennai':       { lat: 13.1149, lon: 80.1018 },
  'Kolathur, Chennai':    { lat: 13.1194, lon: 80.2233 },

  // Trichy (Tiruchirappalli)
  'Srirangam, Trichy':    { lat: 10.8637, lon: 78.6914 },
  'Thillai Nagar, Trichy':{ lat: 10.8211, lon: 78.6883 },
  'Cantonment, Trichy':   { lat: 10.7903, lon: 78.7047 },
  'Woraiyur, Trichy':     { lat: 10.8441, lon: 78.6847 },
  'Ariyamangalam, Trichy':{ lat: 10.8600, lon: 78.7600 },
  'Puthur, Trichy':       { lat: 10.7500, lon: 78.6800 },
  'Kattur, Trichy':       { lat: 10.8700, lon: 78.8200 },
  'Golden Rock, Trichy':  { lat: 10.8050, lon: 78.6700 },

  // Coimbatore
  'RS Puram, Coimbatore': { lat: 11.0045, lon: 76.9610 },
  'Gandhipuram, Coimbatore': { lat: 11.0168, lon: 77.0205 },
  'Peelamedu, Coimbatore':{ lat: 11.0239, lon: 77.0411 },
  'Saibaba Colony, Coimbatore': { lat: 11.0120, lon: 77.0150 },
  'Singanallur, Coimbatore': { lat: 10.9915, lon: 77.0356 },
  'Ganapathy, Coimbatore':{ lat: 11.0450, lon: 77.0200 },
  'Ukkadam, Coimbatore':  { lat: 10.9969, lon: 76.9904 },
  'Vadavalli, Coimbatore':{ lat: 10.9813, lon: 76.9267 },

  // Madurai
  'Anna Nagar, Madurai':  { lat: 9.9252, lon: 78.1198 },
  'Tallakulam, Madurai':  { lat: 9.9254, lon: 78.1105 },
  'KK Nagar, Madurai':    { lat: 9.9068, lon: 78.0937 },
  'Iyer Bungalow, Madurai': { lat: 9.9474, lon: 78.0838 },
  'Arasaradi, Madurai':   { lat: 9.9570, lon: 78.1350 },
  'Mattuthavani, Madurai':{ lat: 9.9700, lon: 78.1000 },
  'Villapuram, Madurai':  { lat: 9.8900, lon: 78.1100 },
  'Pasumalai, Madurai':   { lat: 9.9117, lon: 78.1200 },

  // Salem
  'Fairlands, Salem':     { lat: 11.6643, lon: 78.1460 },
  'Hasthampatti, Salem':  { lat: 11.6550, lon: 78.1530 },
  'Suramangalam, Salem':  { lat: 11.6900, lon: 78.1600 },
  'Shevapet, Salem':      { lat: 11.6500, lon: 78.1600 },
  'Ammapet, Salem':       { lat: 11.6730, lon: 78.1830 },
  'Alagapuram, Salem':    { lat: 11.6550, lon: 78.1400 },

  // Tirunelveli
  'Palayamkottai, Tirunelveli': { lat: 8.7139, lon: 77.7567 },
  'Melapalayam, Tirunelveli':   { lat: 8.7200, lon: 77.7200 },
  'Vannarpet, Tirunelveli':     { lat: 8.7319, lon: 77.7094 },
  'Maniyachi, Tirunelveli':     { lat: 8.8000, lon: 77.8000 },
  'Tirunelveli Town':           { lat: 8.7290, lon: 77.7049 },
  'Pettai, Tirunelveli':        { lat: 8.7100, lon: 77.6900 },

  // Vellore
  'Katpadi, Vellore':     { lat: 12.9675, lon: 79.3200 },
  'Sathuvachari, Vellore':{ lat: 12.9510, lon: 79.1700 },
  'Thorapadi, Vellore':   { lat: 12.9200, lon: 79.1500 },
  'Vellore Town':         { lat: 12.9165, lon: 79.1325 },
  'Bagayam, Vellore':     { lat: 12.9300, lon: 79.1500 },

  // Thanjavur
  'Medical College Road, Thanjavur': { lat: 10.7867, lon: 79.1378 },
  'Srinivasa Nagar, Thanjavur':      { lat: 10.7700, lon: 79.1320 },
  'Old Bus Stand, Thanjavur':        { lat: 10.7871, lon: 79.1383 },
  'Thanjavur Town':       { lat: 10.7870, lon: 79.1378 },
  'Punnainallur, Thanjavur': { lat: 10.7600, lon: 79.1200 },

  // Erode
  'Perundurai, Erode':    { lat: 11.2700, lon: 77.5900 },
  'Chithode, Erode':      { lat: 11.3400, lon: 77.7300 },
  'Bhavani, Erode':       { lat: 11.4455, lon: 77.6829 },
  'Erode Town':           { lat: 11.3410, lon: 77.7172 },
  'Surampatti, Erode':    { lat: 11.3700, lon: 77.7400 },

  // Tirupur
  'Palladam, Tirupur':    { lat: 10.9990, lon: 77.2880 },
  'Avinashi, Tirupur':    { lat: 11.1900, lon: 77.2700 },
  'Mangalam, Tirupur':    { lat: 11.1260, lon: 77.3600 },
  'Tirupur Town':         { lat: 11.1075, lon: 77.3398 },
  'Rayapuram, Tirupur':   { lat: 11.1100, lon: 77.3600 },

  // Karaikal
  'Karaikal Town':        { lat: 10.9254, lon: 79.8380 },
  'Neravy, Karaikal':     { lat: 10.9100, lon: 79.8200 },
  'Thirunallar, Karaikal':{ lat: 10.9300, lon: 79.8100 },
  'Nannilam, Karaikal':   { lat: 10.9800, lon: 79.8900 },

  // Cuddalore
  'Cuddalore Port':       { lat: 11.7447, lon: 79.7690 },
  'Cuddalore Town':       { lat: 11.7480, lon: 79.7714 },
  'Panruti, Cuddalore':   { lat: 11.7714, lon: 79.5678 },
  'Chidambaram, Cuddalore': { lat: 11.3993, lon: 79.6934 },

  // Villupuram
  'Villupuram Town':      { lat: 11.9390, lon: 79.4928 },
  'Tindivanam, Villupuram': { lat: 12.2373, lon: 79.6561 },
  'Kallakurichi, Villupuram': { lat: 11.7370, lon: 78.9604 },
  'Gingee, Villupuram':   { lat: 12.2500, lon: 79.4200 },
};

// ── Hospital coordinates (major TN + Puducherry hospitals) ───────────────────
const HOSPITAL_COORDS = {
  // Puducherry
  'General Hospital':          { lat: 11.9330, lon: 79.8327 },
  'Government Hospital':       { lat: 11.9330, lon: 79.8327 },
  'JIPMER':                    { lat: 11.9560, lon: 79.8057 },
  'Mahatma Gandhi Hospital':   { lat: 11.9400, lon: 79.8200 },
  'Pondicherry Institute':      { lat: 11.9560, lon: 79.8057 },
  'PIMS':                       { lat: 11.9680, lon: 79.8400 },
  'Kasturba Hospital':          { lat: 11.9380, lon: 79.8300 },
  'Arupadai Veedu Hospital':    { lat: 11.9200, lon: 79.8100 },
  // Chennai
  'Apollo Hospital Chennai':    { lat: 13.0603, lon: 80.2784 },
  'Stanley Hospital':           { lat: 13.1109, lon: 80.2922 },
  'Rajiv Gandhi Government Hospital': { lat: 13.0827, lon: 80.2707 },
  'Kilpauk Medical College':    { lat: 13.0844, lon: 80.2481 },
  // Trichy
  'Mahatma Gandhi Memorial Hospital': { lat: 10.8211, lon: 78.6883 },
  'Sri Ramachandra Hospital Trichy':  { lat: 10.8000, lon: 78.7000 },
  // Coimbatore
  'Coimbatore Medical College': { lat: 11.0248, lon: 77.0218 },
  'PSG Hospital':               { lat: 11.0200, lon: 77.0150 },
  // Madurai
  'Meenakshi Mission Hospital': { lat: 9.9325,  lon: 78.1198 },
  'Rajaji Government Hospital': { lat: 9.9156,  lon: 78.1199 },
  // Vellore
  'CMC Vellore':                { lat: 12.9239, lon: 79.1347 },
};

const PUDUCHERRY_CENTER = { lat: 11.9416, lon: 79.8083 };

// City centre fallbacks — used when area is unknown but city is known
const CITY_CENTERS = {
  'chennai':     { lat: 13.0827, lon: 80.2707 },
  'trichy':      { lat: 10.8210, lon: 78.6970 },
  'coimbatore':  { lat: 11.0168, lon: 77.0205 },
  'madurai':     { lat: 9.9252,  lon: 78.1198 },
  'salem':       { lat: 11.6643, lon: 78.1460 },
  'tirunelveli': { lat: 8.7290,  lon: 77.7049 },
  'vellore':     { lat: 12.9165, lon: 79.1325 },
  'thanjavur':   { lat: 10.7870, lon: 79.1378 },
  'erode':       { lat: 11.3410, lon: 77.7172 },
  'tirupur':     { lat: 11.1075, lon: 77.3398 },
  'karaikal':    { lat: 10.9254, lon: 79.8380 },
  'cuddalore':   { lat: 11.7480, lon: 79.7714 },
  'villupuram':  { lat: 11.9390, lon: 79.4928 },
};

// ── Haversine distance (km) ───────────────────────────────────────────────────
function distanceKm(lat1, lon1, lat2, lon2) {
  const R    = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a    =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Get hospital coords (fuzzy match) ─────────────────────────────────────────
function getHospitalCoords(hospitalName) {
  if (!hospitalName) return PUDUCHERRY_CENTER;
  const name = hospitalName.toLowerCase();
  for (const [key, coords] of Object.entries(HOSPITAL_COORDS)) {
    if (name.includes(key.toLowerCase()) || key.toLowerCase().includes(name.split(' ')[0].toLowerCase())) {
      return coords;
    }
  }
  return PUDUCHERRY_CENTER; // default to city centre
}

// ── Get area coords ───────────────────────────────────────────────────────────
function getAreaCoords(area) {
  if (!area) return PUDUCHERRY_CENTER;
  const a = area.trim();
  // Exact match first
  if (AREA_COORDS[a]) return AREA_COORDS[a];
  // Fuzzy match — area string contains key or key contains area string
  const key = Object.keys(AREA_COORDS).find(k =>
    k.toLowerCase().includes(a.toLowerCase()) ||
    a.toLowerCase().includes(k.toLowerCase())
  );
  if (key) return AREA_COORDS[key];
  // City-level fallback — check if area string mentions a known city
  const aLower = a.toLowerCase();
  for (const [city, coords] of Object.entries(CITY_CENTERS)) {
    if (aLower.includes(city)) return coords;
  }
  return PUDUCHERRY_CENTER;
}

// ── Sort donors by proximity to hospital ─────────────────────────────────────
function sortByProximity(donors, hospitalName) {
  const hCoords = getHospitalCoords(hospitalName);
  return donors
    .map(d => {
      // Precision chain: exact GPS (if donor shared it) → area centroid
      const dCoords = (d.lat != null && d.lng != null)
        ? { lat: Number(d.lat), lon: Number(d.lng) }
        : getAreaCoords(d.area);
      const km = distanceKm(dCoords.lat, dCoords.lon, hCoords.lat, hCoords.lon);
      return { ...d, distanceKm: Math.round(km * 10) / 10 };
    })
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

module.exports = {
  AREA_COORDS,
  HOSPITAL_COORDS,
  CITY_CENTERS,
  sortByProximity,
  getHospitalCoords,
  getAreaCoords,
  distanceKm,
};
