import express, { Express, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';

export class AssetController {
    private assetsDir: string;
    private thumbsDir: string;
    private uiDir: string;
    private upload: multer.Multer;

    constructor(baseDir: string) {
        this.assetsDir = path.join(baseDir, 'storage', 'assets');
        this.thumbsDir = path.join(this.assetsDir, 'thumbnails');
        this.uiDir = path.join(baseDir, 'src', 'server', 'assets');

        this.ensureDirectories();

        const storage = multer.diskStorage({
            destination: (req, file, cb) => {
                if (file.fieldname === 'thumbnail') {
                    cb(null, this.thumbsDir);
                } else {
                    cb(null, this.assetsDir);
                }
            },
            filename: (req, file, cb) => {
                const safeName = path.basename(file.originalname);
                if (file.fieldname === 'thumbnail') {
                    cb(null, safeName + '.webp');
                } else {
                    cb(null, safeName);
                }
            }
        });

        this.upload = multer({ storage });
    }

    private ensureDirectories(): void {
        if (!fs.existsSync(this.assetsDir)) {
            fs.mkdirSync(this.assetsDir, { recursive: true });
        }
        if (!fs.existsSync(this.thumbsDir)) {
            fs.mkdirSync(this.thumbsDir, { recursive: true });
        }
    }

    public register(app: Express): void {
        // List all assets
        app.get('/api/assets', (req: Request, res: Response) => {
            try {
                const files = fs.readdirSync(this.assetsDir).filter(f => f !== 'thumbnails');
                const fileList = files.map(file => {
                    const stats = fs.statSync(path.join(this.assetsDir, file));
                    const thumbName = file + '.webp';
                    const hasThumb = fs.existsSync(path.join(this.thumbsDir, thumbName));
                    return {
                        name: file,
                        size: stats.size,
                        mtime: stats.mtime,
                        url: `/storage/assets/${file}`,
                        thumbnailUrl: hasThumb ? `/storage/assets/thumbnails/${thumbName}` : null
                    };
                });
                res.json(fileList);
            } catch (error) {
                res.status(500).json({ error: 'Failed to list assets' });
            }
        });

        // Upload a new asset
        app.post('/api/assets/upload', this.upload.fields([
            { name: 'file', maxCount: 1 },
            { name: 'thumbnail', maxCount: 1 }
        ]), (req: Request, res: Response) => {
            const files = req.files as { [fieldname: string]: Express.Multer.File[] };
            if (!files || !files.file) {
                return res.status(400).json({ error: 'No file uploaded' });
            }
            const uploadedFile = files.file[0];
            const thumbnailFile = files.thumbnail ? files.thumbnail[0] : null;

            res.json({
                success: true,
                file: {
                    name: uploadedFile.filename,
                    url: `/storage/assets/${uploadedFile.filename}`,
                    thumbnailUrl: thumbnailFile ? `/storage/assets/thumbnails/${thumbnailFile.filename}` : null
                }
            });
        });

        // Delete an asset
        app.delete('/api/assets/:filename', (req: Request, res: Response) => {
            const filename = req.params.filename as string;
            const safeName = path.basename(filename);
            const filePath = path.join(this.assetsDir, safeName);

            if (!fs.existsSync(filePath)) {
                return res.status(404).json({ error: 'File not found' });
            }

            try {
                fs.unlinkSync(filePath);
                const thumbPath = path.join(this.thumbsDir, safeName + '.webp');
                if (fs.existsSync(thumbPath)) {
                    fs.unlinkSync(thumbPath);
                }
                res.json({ success: true });
            } catch (error) {
                res.status(500).json({ error: 'Failed to delete file' });
            }
        });

        // Serve storage and UI
        app.use('/storage/assets', express.static(this.assetsDir));
        app.use('/assets', express.static(this.uiDir));
    }
}
