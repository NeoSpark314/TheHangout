async function fetchAssets() {
    const listContainer = document.getElementById('assets-list');
    try {
        const response = await fetch('/api/assets');
        const assets = await response.json();

        if (assets.length === 0) {
            listContainer.innerHTML = '<div class="synth-empty">No assets found on server.</div>';
            return;
        }

        listContainer.innerHTML = assets.map(asset => `
            <div class="synth-card synth-panel asset-card">
                <div class="asset-info">
                    <div class="asset-name">${asset.name}</div>
                    <div class="asset-meta">
                        Size: ${(asset.size / 1024).toFixed(2)} KB<br>
                        Modified: ${new Date(asset.mtime).toLocaleString()}
                    </div>
                </div>
                <div class="asset-actions">
                    <a href="${asset.url}" target="_blank" class="synth-button" style="flex: 1; text-align: center;">Download</a>
                    <button onclick="deleteAsset('${asset.name}')" class="synth-button is-danger">Delete</button>
                </div>
            </div>
        `).join('');
    } catch (error) {
        listContainer.innerHTML = '<div class="synth-empty" style="color: var(--synth-danger);">Failed to load assets.</div>';
    }
}

async function deleteAsset(filename) {
    if (!confirm(`Are you sure you want to delete "${filename}"?`)) return;

    try {
        const response = await fetch(`/api/assets/${encodeURIComponent(filename)}`, {
            method: 'DELETE'
        });
        const result = await response.json();
        if (result.success) {
            fetchAssets();
        } else {
            alert('Failed to delete: ' + (result.error || 'Unknown error'));
        }
    } catch (error) {
        alert('Error deleting asset: ' + error.message);
    }
}

async function uploadFile(file) {
    const progress = document.getElementById('upload-progress');
    progress.style.display = 'block';

    const formData = new FormData();
    formData.append('file', file);

    try {
        const response = await fetch('/api/assets/upload', {
            method: 'POST',
            body: formData
        });
        const result = await response.json();
        if (result.success) {
            fetchAssets();
        } else {
            alert('Upload failed: ' + (result.error || 'Unknown error'));
        }
    } catch (error) {
        alert('Error uploading: ' + error.message);
    } finally {
        progress.style.display = 'none';
    }
}

// Setup Event Listeners
document.getElementById('refresh-btn').onclick = fetchAssets;

const fileInput = document.getElementById('file-input');
fileInput.onchange = (e) => {
    if (e.target.files.length > 0) {
        uploadFile(e.target.files[0]);
    }
};

const uploadZone = document.getElementById('upload-zone');
uploadZone.ondragover = (e) => {
    e.preventDefault();
    uploadZone.classList.add('dragover');
};
uploadZone.ondragleave = () => {
    uploadZone.classList.remove('dragover');
};
uploadZone.ondrop = (e) => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
        uploadFile(e.dataTransfer.files[0]);
    }
};

// Initial load
fetchAssets();

// Global for inline button click
window.deleteAsset = deleteAsset;
