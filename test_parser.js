const { parseManifestText } = require('./src/services/manifestService');
const fs = require('fs');

// Test AK397
const pax397 = fs.readFileSync('./uploads/manifests/CONTOH AK397/pax 397.txt', 'utf-8');
const result397 = parseManifestText(pax397);
const seg397 = result397[0];
console.log('=== AK 397 (pax format) ===');
console.log('Flight:', seg397.flight_number, '| Route:', seg397.origin, '->', seg397.destination);
console.log('Total passengers:', seg397.passengers.length);
console.log('Total no-shows:', seg397.no_shows.length);
console.log('First 5 passengers:');
seg397.passengers.slice(0, 5).forEach(function(p, i) {
  console.log('  ' + (i+1) + '. Name: ' + p.name + ' | PNR: ' + p.pnr + ' | Seat: ' + p.seat_no + ' | Level: ' + p.level);
});
const rawOnly397 = seg397.passengers.filter(function(p) { return p.pnr === undefined; });
console.log('Parsed OK:', (seg397.passengers.length - rawOnly397.length) + '/' + seg397.passengers.length);
if (rawOnly397.length > 0) {
  console.log('FAILED lines:');
  rawOnly397.slice(0, 3).forEach(function(p) { console.log('  ' + p.raw_line); });
}

console.log('');

// Test QZ157
const pax157 = fs.readFileSync('./uploads/manifests/CONTOH QZ157/pax 157.txt', 'utf-8');
const result157 = parseManifestText(pax157);
const seg157 = result157[0];
console.log('=== QZ 157 (pax format) ===');
console.log('Flight:', seg157.flight_number, '| Route:', seg157.origin, '->', seg157.destination);
console.log('Total passengers:', seg157.passengers.length);
console.log('First 3 passengers:');
seg157.passengers.slice(0, 3).forEach(function(p, i) {
  console.log('  ' + (i+1) + '. Name: ' + p.name + ' | PNR: ' + p.pnr + ' | Seat: ' + p.seat_no);
});
const rawOnly157 = seg157.passengers.filter(function(p) { return p.pnr === undefined; });
console.log('Parsed OK:', (seg157.passengers.length - rawOnly157.length) + '/' + seg157.passengers.length);

console.log('');

// Test JT133 (MANIFEST format)
const jt133 = fs.readFileSync('./uploads/manifests/CONTOH JT133/MANIFEST JT133.txt', 'utf-8');
const resultJT = parseManifestText(jt133);
console.log('=== JT 133 (manifest format) ===');
console.log('Segments found:', resultJT.length);
if (resultJT.length > 0) {
  console.log('First segment passengers:', resultJT[0].passengers.length);
} else {
  console.log('NOTE: JT133 uses different format (SEAT GEN NAME), not "Flight:" header - expected 0 segments from this parser');
}

// Check a passenger with level indicator (P)
const withLevel = seg397.passengers.filter(function(p) { return p.level; });
console.log('');
console.log('=== Passengers with Level indicator ===');
withLevel.forEach(function(p) {
  console.log('  Name: ' + p.name + ' | Level: ' + p.level + ' | PNR: ' + p.pnr);
});
