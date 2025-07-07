const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const { getMp3Bitrate } = require('./common-processor');

async function processMp3Files(progressCallback, folderPath, outputPath, files, options) {
    const { bitrate = 64, threshold = 64, keepStructure = true, forceProcess = false, encodingMode = 'abr' } = options;
    await fs.mkdir(outputPath, { recursive: true });

    const results = [];
    let processedCount = 0;
    const totalFiles = files.length;

    for (const file of files) {
        progressCallback({ current: processedCount, total: totalFiles, file: file.name, status: 'processing' });

        try {
            const currentBitrate = await getMp3Bitrate(file.path);
            
            if (!forceProcess && currentBitrate && currentBitrate <= threshold) {
                results.push({
                    file: file.name,
                    status: 'skipped',
                    message: `跳过: 当前比特率 ${currentBitrate}kbps <= 阈值 ${threshold}kbps`
                });
            } else {
                let outputFilePath;
                if (keepStructure) {
                    const relativePath = path.relative(folderPath, file.path);
                    outputFilePath = path.join(outputPath, relativePath);
                    await fs.mkdir(path.dirname(outputFilePath), { recursive: true });
                } else {
                    outputFilePath = path.join(outputPath, file.name);
                }

                await compressMp3(file.path, outputFilePath, bitrate, encodingMode);
                results.push({ file: file.name, status: 'success', message: `压缩成功 -> ${bitrate}kbps (${encodingMode.toUpperCase()})` });
            }
        } catch (error) {
            results.push({ file: file.name, status: 'error', message: error.message });
        }
        processedCount++;
    }

    return {
        processed: results.filter(r => r.status === 'success').length,
        skipped: results.filter(r => r.status === 'skipped').length,
        failed: results.filter(r => r.status === 'error').length,
        details: results
    };
}

function compressMp3(inputPath, outputPath, bitrate, encodingMode) {
    return new Promise((resolve, reject) => {
        const args = [
            '-i', inputPath,
            '-b:a', `${bitrate}k`,
        ];

        if (encodingMode === 'cbr') {
            args.push('-minrate', `${bitrate}k`, '-maxrate', `${bitrate}k`);
        }
        
        args.push('-y', outputPath); // Overwrite output file

        const ffmpeg = spawn('ffmpeg', args);

        let stderr = '';
        ffmpeg.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        ffmpeg.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`FFmpeg_Error: ${stderr}`));
            }
        });

        ffmpeg.on('error', (err) => {
            reject(err);
        });
    });
}

module.exports = { processMp3Files }; 