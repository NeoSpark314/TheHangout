import * as THREE from 'https://esm.sh/three@0.160.0';
import { GLTFLoader } from 'https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader';

async function fetchAssets() {
    const listContainer = document.getElementById('assets-list');
    try {
        const response = await fetch('/api/assets');
        const assets = await response.json();

        if (assets.length === 0) {
            listContainer.innerHTML = '<div class="synth-empty">No assets found on server.</div>';
            return;
        }

        listContainer.innerHTML = assets.map(asset => {
            const fullUrl = `${window.location.origin}${asset.url}`;
            const thumbHtml = asset.thumbnailUrl
                ? `<img src="${asset.thumbnailUrl}" alt="${asset.name} thumbnail">`
                : `<div class="asset-thumb-placeholder">${asset.name.split('.').pop().toUpperCase()}</div>`;

            return `
                <div class="synth-card synth-panel asset-card">
                    <div class="asset-thumb">
                        ${thumbHtml}
                    </div>
                    <div class="asset-info">
                        <div class="asset-name">${asset.name}</div>
                        <div class="asset-meta">
                            Size: ${(asset.size / 1024).toFixed(2)} KB<br>
                            Modified: ${new Date(asset.mtime).toLocaleString()}
                        </div>
                    </div>
                    <div class="asset-actions">
                        <button onclick="copyToClipboard('${fullUrl}', this)" class="synth-button" style="flex: 1;">Copy Link</button>
                        <button onclick="deleteAsset('${asset.name}')" class="synth-button is-danger">Delete</button>
                    </div>
                </div>
            `;
        }).join('');
    } catch (error) {
        listContainer.innerHTML = '<div class="synth-empty" style="color: var(--synth-danger);">Failed to load assets.</div>';
    }
}

async function generateThumbnail(file) {
    const extension = file.name.split('.').pop().toLowerCase();

    if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(extension)) {
        return generateImageThumbnail(file);
    } else if (['gltf', 'glb'].includes(extension)) {
        return generateGLTFThumbnail(file);
    }
    return null;
}

async function generateImageThumbnail(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX_WIDTH = 256;
                const MAX_HEIGHT = 256;
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > MAX_WIDTH) {
                        height *= MAX_WIDTH / width;
                        width = MAX_WIDTH;
                    }
                } else {
                    if (height > MAX_HEIGHT) {
                        width *= MAX_HEIGHT / height;
                        height = MAX_HEIGHT;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                canvas.toBlob((blob) => resolve(blob), 'image/webp', 0.8);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

async function generateGLTFThumbnail(file) {
    return new Promise(async (resolve) => {
        const url = URL.createObjectURL(file);
        const loader = new GLTFLoader();

        loader.load(url, (gltf) => {
            const scene = new THREE.Scene();
            scene.background = new THREE.Color(0x12072c);

            const model = gltf.scene;
            scene.add(model);

            // Center and scale model
            const box = new THREE.Box3().setFromObject(model);
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());
            model.position.sub(center);

            const maxDim = Math.max(size.x, size.y, size.z);
            const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
            camera.position.set(maxDim * 1.2, maxDim * 1.2, maxDim * 1.2);
            camera.lookAt(0, 0, 0);

            const light = new THREE.DirectionalLight(0xffffff, 1);
            light.position.set(10, 10, 10);
            scene.add(light);
            scene.add(new THREE.AmbientLight(0xffffff, 0.5));

            const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
            renderer.setSize(256, 256);
            renderer.render(scene, camera);

            renderer.domElement.toBlob((blob) => {
                renderer.dispose();
                URL.revokeObjectURL(url);
                resolve(blob);
            }, 'image/webp', 0.8);
        }, undefined, (err) => {
            console.error('Error loading GLTF for thumbnail:', err);
            resolve(null);
        });
    });
}

async function uploadFile(file) {
    const progress = document.getElementById('upload-progress');
    progress.style.display = 'block';

    const formData = new FormData();
    formData.append('file', file);

    const thumbBlob = await generateThumbnail(file);
    if (thumbBlob) {
        formData.append('thumbnail', thumbBlob, file.name);
    }

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
        const fileInput = document.getElementById('file-input');
        if (fileInput) fileInput.value = '';
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

async function copyToClipboard(text, btn) {
    try {
        await navigator.clipboard.writeText(text);
        const originalText = btn.innerText;
        btn.innerText = 'Copied!';
        btn.classList.add('is-success');
        setTimeout(() => {
            btn.innerText = originalText;
            btn.classList.remove('is-success');
        }, 2000);
    } catch (err) {
        console.error('Failed to copy: ', err);
        alert('Failed to copy to clipboard');
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

// Global exports for inline handlers
window.deleteAsset = deleteAsset;
window.copyToClipboard = copyToClipboard;
window.fetchAssets = fetchAssets;
