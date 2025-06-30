const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');

async function processVideoFiles(progressCallback, folderPath, outputPath, files, options) {
    const outputDir = path.join(outputPath, 'video_output');
    await fs.mkdir(outputDir, { recursive: true });

    let processedCount = 0;
    const totalFiles = files.length;
    const results = { processed: 0, failed: 0 };

    for (const file of files) {
        progressCallback({ current: processedCount, total: totalFiles, file: file.name, status: 'processing' });
        try {
            await processVideo(file.path, outputDir, options);
            results.processed++;
        } catch (error) {
            console.error(`Error processing video ${file.name}:`, error);
            results.failed++;
        }
        processedCount++;
    }
    return results;
}

function processVideo(inputPath, outputBasePath, options) {
    return new Promise((resolve, reject) => {
        const {
            lessonName,
            resolution,
            bitrate,
            segmentDuration,
            rename
        } = options;

        const fileExt = path.extname(inputPath);
        const baseName = path.basename(inputPath, fileExt);

        let outputName;
        if (rename) {
            const lessonDir = path.join(outputBasePath, lessonName);
            fs.mkdir(lessonDir, { recursive: true });
            const files = fs.readdirSync(lessonDir);
            const nextIndex = files.filter(f => f.startsWith('part')).length + 1;
            outputName = `part${nextIndex.toString().padStart(2, '0')}`;
        } else {
            outputName = baseName;
        }

        const outputDir = path.join(outputBasePath, lessonName || '', outputName);
        fs.mkdir(outputDir, { recursive: true });

        const resolutionMap = {
            '720p': '1280:720',
            '1080p': '1920:1080'
        };

        const args = [
            '-i', inputPath,
            '-c:v', 'libx264',
            '-c:a', 'aac',
            '-b:v', `${bitrate}k`,
            '-vf', `scale=w=${resolutionMap[resolution]}:force_original_aspect_ratio=decrease`,
            '-hls_time', segmentDuration.toString(),
            '-hls_list_size', '0',
            '-f', 'hls',
            path.join(outputDir, 'index.m3u8')
        ];

        const ffmpeg = spawn('ffmpeg', args);

        let stderr = '';
        ffmpeg.stderr.on('data', (data) => { stderr += data.toString(); });
        ffmpeg.on('close', (code) => code === 0 ? resolve() : reject(new Error(`FFmpeg_Error: ${stderr}`)));
        ffmpeg.on('error', (err) => reject(err));
    });
}

module.exports = { processVideoFiles }; 