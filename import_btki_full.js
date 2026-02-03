require('dotenv').config();
const mongoose = require('mongoose');
const https = require('https');
const http = require('http');

// URL file SQL dari hub
const SQL_URL = 'https://www.genspark.ai/api/files/s/xCizf9IO';

// Parse SQL INSERT statements ke array objects
function parseSQLInserts(sqlContent) {
    const records = [];
    
    // Regex untuk match value tuples
    const valueRegex = /\('([^']*)',\s*'([^']*)',\s*'([^']*)',\s*'([^']*)',\s*'([^']*)',\s*'([^']*)',\s*'([^']*)',\s*'([^']*)',\s*(\d+),\s*NOW\(\),\s*NOW\(\)\)/g;
    
    let match;
    while ((match = valueRegex.exec(sqlContent)) !== null) {
        records.push({
            hs_code: match[1],
            chapter: match[2],
            description_id: match[3],
            description_en: match[4],
            import_duty: match[5],
            export_duty: match[6],
            ppn: match[7],
            ppnbm: match[8],
            hs_level: parseInt(match[9]),
            created_at: new Date(),
            updated_at: new Date()
        });
    }
    
    return records;
}

// Download file dari URL
function downloadFile(url) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        
        const request = protocol.get(url, { 
            headers: { 'User-Agent': 'SkyGuard-Import/1.0' }
        }, (response) => {
            // Handle redirects
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                console.log(`Redirecting to: ${response.headers.location}`);
                downloadFile(response.headers.location).then(resolve).catch(reject);
                return;
            }
            
            if (response.statusCode !== 200) {
                reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
                return;
            }
            
            let data = '';
            response.on('data', chunk => data += chunk);
            response.on('end', () => resolve(data));
            response.on('error', reject);
        });
        
        request.on('error', reject);
        request.setTimeout(60000, () => {
            request.destroy();
            reject(new Error('Request timeout'));
        });
    });
}

async function importBTKI() {
    try {
        console.log('🔗 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB');
        
        const db = mongoose.connection.db;
        const collection = db.collection('hs_codes');
        
        console.log('📥 Downloading BTKI SQL file...');
        const sqlContent = await downloadFile(SQL_URL);
        console.log(`✅ Downloaded ${sqlContent.length} bytes`);
        
        console.log('🔍 Parsing SQL INSERT statements...');
        const records = parseSQLInserts(sqlContent);
        console.log(`✅ Parsed ${records.length} records`);
        
        if (records.length === 0) {
            throw new Error('No records parsed from SQL file');
        }
        
        // Drop existing collection and create new
        console.log('🗑️  Dropping existing collection...');
        await collection.drop().catch(() => console.log('   (collection did not exist)'));
        
        // Insert in batches of 1000
        const batchSize = 1000;
        let inserted = 0;
        
        console.log('📤 Inserting records...');
        for (let i = 0; i < records.length; i += batchSize) {
            const batch = records.slice(i, i + batchSize);
            await collection.insertMany(batch, { ordered: false });
            inserted += batch.length;
            console.log(`   Progress: ${inserted}/${records.length} (${Math.round(inserted/records.length*100)}%)`);
        }
        
        // Create indexes
        console.log('📊 Creating indexes...');
        await collection.createIndex({ hs_code: 1 }, { unique: true });
        await collection.createIndex({ chapter: 1 });
        await collection.createIndex({ description_id: 'text', description_en: 'text' });
        await collection.createIndex({ hs_level: 1 });
        
        // Verify
        const count = await collection.countDocuments();
        console.log(`\n✅ IMPORT COMPLETE!`);
        console.log(`   Total records: ${count}`);
        console.log(`   Collection: hs_codes`);
        
        // Sample check
        const sample = await collection.findOne({ chapter: '85' });
        if (sample) {
            console.log(`\n📱 Sample BAB 85 (Elektronik):`);
            console.log(`   HS Code: ${sample.hs_code}`);
            console.log(`   Description: ${sample.description_id}`);
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        console.log('\n🔌 Disconnected from MongoDB');
    }
}

importBTKI();
