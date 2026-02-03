require('dotenv').config();
const mongoose = require('mongoose');

// Sample data untuk beberapa HS code penting (HP, Laptop, Jam, dll)
const sampleData = [
    // BAB 85 - Peralatan Listrik (HP, dll)
    {hs_code:"85.17",chapter:"85",description_id:"Pesawat telepon, termasuk telepon seluler",description_en:"Telephone sets, including cellular phones",import_duty:"",ppn:"",ppnbm:"",hs_level:4},
    {hs_code:"8517.13.00",chapter:"85",description_id:"- - Telepon pintar (Smartphone)",description_en:"- - Smartphones",import_duty:"0",ppn:"11",ppnbm:"-",hs_level:8},
    {hs_code:"8517.14.00",chapter:"85",description_id:"- - Telepon untuk jaringan seluler lainnya",description_en:"- - Telephones for cellular networks",import_duty:"0",ppn:"11",ppnbm:"-",hs_level:8},
    {hs_code:"8517.18.00",chapter:"85",description_id:"- - Lain-lain (telepon)",description_en:"- - Other telephones",import_duty:"0",ppn:"11",ppnbm:"-",hs_level:8},
    
    // BAB 84 - Mesin (Laptop, PC)
    {hs_code:"84.71",chapter:"84",description_id:"Mesin pengolah data otomatis dan unitnya",description_en:"Automatic data-processing machines",import_duty:"",ppn:"",ppnbm:"",hs_level:4},
    {hs_code:"8471.30.00",chapter:"84",description_id:"- Mesin pengolah data portabel (Laptop)",description_en:"- Portable automatic data-processing machines",import_duty:"0",ppn:"11",ppnbm:"-",hs_level:8},
    {hs_code:"8471.41.00",chapter:"84",description_id:"- - Unit pengolah lainnya dalam satu housing",description_en:"- - Other, comprising in same housing",import_duty:"0",ppn:"11",ppnbm:"-",hs_level:8},
    {hs_code:"8471.49.00",chapter:"84",description_id:"- - Lain-lain, dalam bentuk sistem",description_en:"- - Other, presented in the form of systems",import_duty:"0",ppn:"11",ppnbm:"-",hs_level:8},
    
    // BAB 91 - Jam
    {hs_code:"91.01",chapter:"91",description_id:"Jam tangan, jam saku dengan case logam mulia",description_en:"Wrist-watches, pocket-watches with case of precious metal",import_duty:"",ppn:"",ppnbm:"",hs_level:4},
    {hs_code:"9101.11.00",chapter:"91",description_id:"- - Dengan tampilan mekanis saja",description_en:"- - With mechanical display only",import_duty:"10",ppn:"11",ppnbm:"20",hs_level:8},
    {hs_code:"9101.19.00",chapter:"91",description_id:"- - Lain-lain",description_en:"- - Other",import_duty:"10",ppn:"11",ppnbm:"20",hs_level:8},
    {hs_code:"91.02",chapter:"91",description_id:"Jam tangan, jam saku lainnya",description_en:"Wrist-watches, pocket-watches, other",import_duty:"",ppn:"",ppnbm:"",hs_level:4},
    {hs_code:"9102.11.00",chapter:"91",description_id:"- - Dengan tampilan mekanis saja",description_en:"- - With mechanical display only",import_duty:"10",ppn:"11",ppnbm:"-",hs_level:8},
    {hs_code:"9102.12.00",chapter:"91",description_id:"- - Dengan tampilan opto-elektronik saja",description_en:"- - With opto-electronic display only",import_duty:"10",ppn:"11",ppnbm:"-",hs_level:8},
    {hs_code:"9102.19.00",chapter:"91",description_id:"- - Lain-lain",description_en:"- - Other",import_duty:"10",ppn:"11",ppnbm:"-",hs_level:8},
    
    // BAB 42 - Tas
    {hs_code:"42.02",chapter:"42",description_id:"Koper, tas, dompet dan barang sejenis",description_en:"Trunks, cases, handbags, wallets",import_duty:"",ppn:"",ppnbm:"",hs_level:4},
    {hs_code:"4202.11.00",chapter:"42",description_id:"- - Dengan permukaan luar dari kulit samak",description_en:"- - With outer surface of leather",import_duty:"15",ppn:"11",ppnbm:"-",hs_level:8},
    {hs_code:"4202.12.00",chapter:"42",description_id:"- - Dengan permukaan luar dari plastik",description_en:"- - With outer surface of plastics",import_duty:"15",ppn:"11",ppnbm:"-",hs_level:8},
    
    // BAB 71 - Perhiasan
    {hs_code:"71.13",chapter:"71",description_id:"Barang perhiasan dan bagiannya dari logam mulia",description_en:"Articles of jewellery and parts thereof",import_duty:"",ppn:"",ppnbm:"",hs_level:4},
    {hs_code:"7113.11.00",chapter:"71",description_id:"- - Dari perak",description_en:"- - Of silver",import_duty:"10",ppn:"11",ppnbm:"20",hs_level:8},
    {hs_code:"7113.19.00",chapter:"71",description_id:"- - Dari logam mulia lainnya",description_en:"- - Of other precious metal",import_duty:"10",ppn:"11",ppnbm:"20",hs_level:8},
    
    // BAB 64 - Sepatu
    {hs_code:"64.03",chapter:"64",description_id:"Alas kaki dengan sol luar dari karet, plastik, kulit",description_en:"Footwear with outer soles of rubber, plastics, leather",import_duty:"",ppn:"",ppnbm:"",hs_level:4},
    {hs_code:"6403.19.00",chapter:"64",description_id:"- - Lain-lain",description_en:"- - Other",import_duty:"25",ppn:"11",ppnbm:"-",hs_level:8},
    {hs_code:"6403.51.00",chapter:"64",description_id:"- - Menutupi mata kaki",description_en:"- - Covering the ankle",import_duty:"25",ppn:"11",ppnbm:"-",hs_level:8},
    
    // BAB 33 - Kosmetik
    {hs_code:"33.04",chapter:"33",description_id:"Preparat kecantikan, make-up, perawatan kulit",description_en:"Beauty, make-up, skin care preparations",import_duty:"",ppn:"",ppnbm:"",hs_level:4},
    {hs_code:"3304.10.00",chapter:"33",description_id:"- Preparat tata rias bibir",description_en:"- Lip make-up preparations",import_duty:"15",ppn:"11",ppnbm:"-",hs_level:8},
    {hs_code:"3304.20.00",chapter:"33",description_id:"- Preparat tata rias mata",description_en:"- Eye make-up preparations",import_duty:"15",ppn:"11",ppnbm:"-",hs_level:8},
    
    // BAB 22 - Minuman
    {hs_code:"22.03",chapter:"22",description_id:"Bir yang dibuat dari malt",description_en:"Beer made from malt",import_duty:"",ppn:"",ppnbm:"",hs_level:4},
    {hs_code:"2203.00.10",chapter:"22",description_id:"- Bir hitam (stout)",description_en:"- Stout",import_duty:"35",ppn:"11",ppnbm:"-",hs_level:8},
    {hs_code:"22.08",chapter:"22",description_id:"Etil alkohol, minuman keras",description_en:"Spirits, liqueurs",import_duty:"",ppn:"",ppnbm:"",hs_level:4},
    {hs_code:"2208.30.00",chapter:"22",description_id:"- Wiski",description_en:"- Whiskies",import_duty:"150",ppn:"11",ppnbm:"-",hs_level:8},
    
    // BAB 24 - Tembakau
    {hs_code:"24.02",chapter:"24",description_id:"Cerutu, rokok, dari tembakau atau pengganti tembakau",description_en:"Cigars, cigarettes, of tobacco or tobacco substitutes",import_duty:"",ppn:"",ppnbm:"",hs_level:4},
    {hs_code:"2402.20.00",chapter:"24",description_id:"- Rokok kretek dan rokok lainnya",description_en:"- Clove cigarettes and other cigarettes",import_duty:"40",ppn:"11",ppnbm:"-",hs_level:8},
    
    // BAB 01-05 - Binatang (contoh)
    {hs_code:"01.01",chapter:"01",description_id:"Kuda, keledai, bagal dan hinnie, hidup",description_en:"Live horses, asses, mules and hinnies",import_duty:"",ppn:"",ppnbm:"",hs_level:4},
    {hs_code:"01.01.21.00",chapter:"01",description_id:"- - Bibit",description_en:"- - Pure-bred breeding animals",import_duty:"0",ppn:"-",ppnbm:"-",hs_level:8}
];

async function importData() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');
        
        const db = mongoose.connection.db;
        const collection = db.collection('hs_codes');
        
        // Clear existing and insert new
        await collection.deleteMany({});
        const result = await collection.insertMany(sampleData);
        console.log('Inserted', result.insertedCount, 'HS codes');
        
        // Create index
        await collection.createIndex({ hs_code: 1 });
        await collection.createIndex({ chapter: 1 });
        await collection.createIndex({ description_id: "text", description_en: "text" });
        console.log('Indexes created');
        
        await mongoose.disconnect();
        console.log('Done!');
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

importData();
