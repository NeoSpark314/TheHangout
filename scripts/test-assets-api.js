import fs from 'fs';
import path from 'path';

const API_URL = 'https://localhost:9000/api/assets';
const TEST_FILE = 'test_upload.txt';
const TEST_CONTENT = 'This is a test file for the asset management endpoint.';

async function runTest() {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // Bypass self-signed cert issues for test

    console.log('--- Asset API Test ---');

    try {
        // 1. Create a test file
        fs.writeFileSync(TEST_FILE, TEST_CONTENT);
        console.log(`[1] Created test file: ${TEST_FILE}`);

        // 2. Upload the file
        // Using fetch with FormData
        const formData = new FormData();
        const blob = new Blob([TEST_CONTENT], { type: 'text/plain' });
        formData.append('file', blob, TEST_FILE);

        console.log(`[2] Uploading ${TEST_FILE}...`);
        const uploadRes = await fetch(`${API_URL}/upload`, {
            method: 'POST',
            body: formData
        });
        const uploadData = await uploadRes.json();
        console.log('Upload Result:', uploadData);

        if (!uploadData.success) throw new Error('Upload failed');

        // 3. List assets
        console.log(`[3] Listing assets...`);
        const listRes = await fetch(API_URL);
        const assets = await listRes.json();
        const found = assets.find(a => a.name === TEST_FILE);
        console.log(`Found in list: ${!!found}`);

        if (!found) throw new Error('File not found in list');

        // 4. Delete asset
        console.log(`[4] Deleting ${TEST_FILE}...`);
        const deleteRes = await fetch(`${API_URL}/${TEST_FILE}`, {
            method: 'DELETE'
        });
        const deleteData = await deleteRes.json();
        console.log('Delete Result:', deleteData);

        if (!deleteData.success) throw new Error('Delete failed');

        // 5. Verify deletion
        console.log(`[5] Verifying deletion...`);
        const verifyRes = await fetch(API_URL);
        const finalAssets = await verifyRes.json();
        const stillFound = finalAssets.find(a => a.name === TEST_FILE);
        console.log(`Still found: ${!!stillFound}`);

        if (stillFound) throw new Error('File still exists after deletion');

        console.log('--- TEST PASSED ---');
    } catch (error) {
        console.error('--- TEST FAILED ---');
        console.error(error);
    } finally {
        if (fs.existsSync(TEST_FILE)) fs.unlinkSync(TEST_FILE);
    }
}

runTest();
