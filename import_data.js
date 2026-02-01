const devices = [
  // iPhone 11 Series
  {brand:"Apple",model:"iPhone 11",variants:[{capacity:"64GB",price_usd:139.14,tax_idr:0},{capacity:"128GB",price_usd:158.31,tax_idr:0},{capacity:"256GB",price_usd:184.33,tax_idr:0}]},
  {brand:"Apple",model:"iPhone 11 Pro",variants:[{capacity:"64GB",price_usd:194.11,tax_idr:0},{capacity:"256GB",price_usd:221.72,tax_idr:0},{capacity:"512GB",price_usd:245.28,tax_idr:0}]},
  {brand:"Apple",model:"iPhone 11 Pro Max",variants:[{capacity:"64GB",price_usd:204.21,tax_idr:0},{capacity:"256GB",price_usd:244.10,tax_idr:0},{capacity:"512GB",price_usd:258.29,tax_idr:0}]},
  // iPhone 12 Series
  {brand:"Apple",model:"iPhone 12",variants:[{capacity:"64GB",price_usd:269.83,tax_idr:0},{capacity:"128GB",price_usd:294.42,tax_idr:0},{capacity:"256GB",price_usd:343.49,tax_idr:0}]},
  {brand:"Apple",model:"iPhone 12 Mini",variants:[{capacity:"64GB",price_usd:235.46,tax_idr:0},{capacity:"128GB",price_usd:260.04,tax_idr:0},{capacity:"256GB",price_usd:309.12,tax_idr:0}]},
  {brand:"Apple",model:"iPhone 12 Pro",variants:[{capacity:"128GB",price_usd:392.6,tax_idr:0},{capacity:"256GB",price_usd:441.67,tax_idr:0},{capacity:"512GB",price_usd:515.24,tax_idr:57209}]},
  {brand:"Apple",model:"iPhone 12 Pro Max",variants:[{capacity:"128GB",price_usd:441.67,tax_idr:0},{capacity:"256GB",price_usd:490.75,tax_idr:0},{capacity:"512GB",price_usd:564.32,tax_idr:241083}]},
  // iPhone 13 Series
  {brand:"Apple",model:"iPhone 13",variants:[{capacity:"128GB",price_usd:343.49,tax_idr:0},{capacity:"256GB",price_usd:392.6,tax_idr:0},{capacity:"512GB",price_usd:490.75,tax_idr:0}]},
  {brand:"Apple",model:"iPhone 13 Mini",variants:[{capacity:"128GB",price_usd:294.42,tax_idr:0},{capacity:"256GB",price_usd:343.49,tax_idr:0},{capacity:"512GB",price_usd:441.67,tax_idr:0}]},
  {brand:"Apple",model:"iPhone 13 Pro",variants:[{capacity:"128GB",price_usd:466.17,tax_idr:0},{capacity:"256GB",price_usd:515.24,tax_idr:57209},{capacity:"512GB",price_usd:588.81,tax_idr:332865},{capacity:"1TB",price_usd:686.96,tax_idr:699857}]},
  {brand:"Apple",model:"iPhone 13 Pro Max",variants:[{capacity:"128GB",price_usd:490.75,tax_idr:0},{capacity:"256GB",price_usd:539.83,tax_idr:149564},{capacity:"512GB",price_usd:637.89,tax_idr:516372},{capacity:"1TB",price_usd:736.05,tax_idr:883384}]},
  // iPhone 14 Series
  {brand:"Apple",model:"iPhone 14",variants:[{capacity:"128GB",price_usd:368.01,tax_idr:0},{capacity:"256GB",price_usd:441.67,tax_idr:0},{capacity:"512GB",price_usd:539.83,tax_idr:149564}]},
  {brand:"Apple",model:"iPhone 14 Plus",variants:[{capacity:"128GB",price_usd:441.67,tax_idr:0},{capacity:"256GB",price_usd:515.24,tax_idr:57209},{capacity:"512GB",price_usd:637.89,tax_idr:516372}]},
  {brand:"Apple",model:"iPhone 14 Pro",variants:[{capacity:"128GB",price_usd:564.32,tax_idr:241083},{capacity:"256GB",price_usd:637.89,tax_idr:516372},{capacity:"512GB",price_usd:796.07,tax_idr:1108293},{capacity:"1TB",price_usd:955.5,tax_idr:1703775}]},
  {brand:"Apple",model:"iPhone 14 Pro Max",variants:[{capacity:"128GB",price_usd:637.89,tax_idr:516372},{capacity:"256GB",price_usd:716.36,tax_idr:810063},{capacity:"512GB",price_usd:875.64,tax_idr:1405548},{capacity:"1TB",price_usd:1035.17,tax_idr:2002146}]},
  // iPhone 15 Series
  {brand:"Apple",model:"iPhone 15",variants:[{capacity:"128GB",price_usd:637.89,tax_idr:516372},{capacity:"256GB",price_usd:716.36,tax_idr:810063},{capacity:"512GB",price_usd:875.64,tax_idr:1405548}]},
  {brand:"Apple",model:"iPhone 15 Plus",variants:[{capacity:"128GB",price_usd:716.36,tax_idr:810063},{capacity:"256GB",price_usd:796.07,tax_idr:1108293},{capacity:"512GB",price_usd:955.5,tax_idr:1703775}]},
  {brand:"Apple",model:"iPhone 15 Pro",variants:[{capacity:"128GB",price_usd:796.07,tax_idr:1108293},{capacity:"256GB",price_usd:875.64,tax_idr:1405548},{capacity:"512GB",price_usd:1035.17,tax_idr:2002146},{capacity:"1TB",price_usd:1194.44,tax_idr:2597968}]},
  {brand:"Apple",model:"iPhone 15 Pro Max",variants:[{capacity:"256GB",price_usd:955.5,tax_idr:1703775},{capacity:"512GB",price_usd:1114.82,tax_idr:2300031},{capacity:"1TB",price_usd:1274.25,tax_idr:2896512}]},
  // iPhone 16 Series
  {brand:"Apple",model:"iPhone 16",variants:[{capacity:"128GB",price_usd:749.06,tax_idr:932026},{capacity:"256GB",price_usd:842.81,tax_idr:1283008},{capacity:"512GB",price_usd:1030.31,tax_idr:1983971}]},
  {brand:"Apple",model:"iPhone 16 Plus",variants:[{capacity:"128GB",price_usd:842.81,tax_idr:1283008},{capacity:"256GB",price_usd:936.56,tax_idr:1632784},{capacity:"512GB",price_usd:1124.07,tax_idr:2334676}]},
  {brand:"Apple",model:"iPhone 16 Pro",variants:[{capacity:"128GB",price_usd:936.56,tax_idr:1632784},{capacity:"256GB",price_usd:1030.31,tax_idr:1983971},{capacity:"512GB",price_usd:1217.82,tax_idr:2685345},{capacity:"1TB",price_usd:1405.32,tax_idr:3386308}]},
  {brand:"Apple",model:"iPhone 16 Pro Max",variants:[{capacity:"256GB",price_usd:1124.07,tax_idr:2334676},{capacity:"512GB",price_usd:1311.57,tax_idr:3035639},{capacity:"1TB",price_usd:1499.07,tax_idr:3736601}]},
  // Samsung
  {brand:"Samsung",model:"Galaxy Z Fold7",variants:[{capacity:"512GB",price_usd:705.98,tax_idr:0},{capacity:"1TB",price_usd:790.85,tax_idr:0}]}
];

// Insert ke MongoDB
const now = new Date();
let deviceCount = 0;
let priceCount = 0;

devices.forEach(d => {
  d.variants.forEach(v => {
    const deviceDoc = {
      brand: d.brand,
      model: d.model,
      capacity: v.capacity,
      created_at: now,
      updated_at: now
    };
    const result = db.devices.insertOne(deviceDoc);
    deviceCount++;
    
    db.price_references.insertOne({
      device_id: result.insertedId,
      price_usd: v.price_usd,
      tax_idr: v.tax_idr,
      source: "Database Handphone.xlsx",
      is_latest: true,
      created_at: now,
      created_by: "initial_import"
    });
    priceCount++;
  });
});

print(`Imported: ${deviceCount} devices, ${priceCount} prices`);
print(`Sample: ${JSON.stringify(db.devices.findOne())}`);
