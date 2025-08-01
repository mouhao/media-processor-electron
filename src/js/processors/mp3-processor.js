const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const { getMp3Bitrate, ffmpegPath } = require('./common-processor');

async function processMp3Files(progressCallback, logCallback, folderPath, outputPath, files, options) {
    const { bitrate = 64, threshold = 64, keepStructure = true, forceProcess = false, encodingMode = 'abr' } = options;
    await fs.mkdir(outputPath, { recursive: true });

    const results = [];
    let processedCount = 0;
    const totalFiles = files.length;
    
    // 初始化进度
    if (progressCallback) {
        progressCallback({ current: 0, total: totalFiles, status: 'analyzing', file: '正在分析MP3文件...' });
    }

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
                if (logCallback) {
                    logCallback('info', `跳过文件 ${file.name}: 当前比特率 ${currentBitrate}kbps <= 阈值 ${threshold}kbps`);
                }
            } else {
                let outputFilePath;
                if (keepStructure) {
                    const relativePath = path.relative(folderPath, file.path);
                    outputFilePath = path.join(outputPath, relativePath);
                    await fs.mkdir(path.dirname(outputFilePath), { recursive: true });
                } else {
                    outputFilePath = path.join(outputPath, file.name);
                }

                await compressMp3(file.path, outputFilePath, bitrate, encodingMode, logCallback);
                results.push({ file: file.name, status: 'success', message: `压缩成功 -> ${bitrate}kbps (${encodingMode.toUpperCase()})` });
                if (logCallback) {
                    logCallback('success', `✅ ${file.name} 压缩成功 -> ${bitrate}kbps (${encodingMode.toUpperCase()})`);
                }
            }
        } catch (error) {
            results.push({ file: file.name, status: 'error', message: error.message });
            if (logCallback) {
                logCallback('error', `❌ ${file.name} 处理失败: ${error.message}`);
            }
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

function compressMp3(inputPath, outputPath, bitrate, encodingMode, logCallback) {
    return new Promise((resolve, reject) => {
        if (!ffmpegPath) {
            return reject(new Error('FFmpeg not found. Please check your installation and configuration.'));
        }

        const args = [
            '-i', inputPath,
            '-b:a', `${bitrate}k`,
        ];

        if (encodingMode === 'cbr') {
            args.push('-minrate', `${bitrate}k`, '-maxrate', `${bitrate}k`);
        }
        
        args.push('-y', outputPath); // Overwrite output file

        // 构建完整的命令字符串用于日志
        const command = `${ffmpegPath} ${args.join(' ')}`;
        
        // 打印命令到日志
        if (logCallback) {
            logCallback('command', `🔧 执行命令: ${command}`);
        }

        const ffmpeg = spawn(ffmpegPath, args);

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