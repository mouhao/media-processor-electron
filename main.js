const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs').promises;

// 导入新的处理器模块
const { checkFfmpeg, scanMediaFiles, processSelectedFiles, getFileDetails } = require('./src/js/processors/common-processor.js');
const { processMp3Files } = require('./src/js/processors/mp3-processor.js');
const { processVideoFiles } = require('./src/js/processors/video-processor.js');
const { composeVideos } = require('./src/js/processors/video-composer.js');
const { processIntroOutro } = require('./src/js/processors/intro-outro-processor.js');
const { processLogoWatermark } = require('./src/js/processors/logo-watermark-processor.js');

// 保持窗口对象的全局引用
let mainWindow;

function createWindow() {
  // 创建浏览器窗口
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    },
    icon: path.join(__dirname, 'src/assets/icons/media.ico'),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false
  });

  // 加载 index.html
  const htmlPath = path.join(__dirname, 'src/index.html');
  console.log('Loading HTML from:', htmlPath);
  mainWindow.loadFile(htmlPath);
  
  // 在 Windows 和 Linux 上移除菜单栏
  if (process.platform !== 'darwin') {
    mainWindow.setMenu(null);
  }

  // 强制禁用缓存
  mainWindow.webContents.session.clearCache();

  // 窗口准备显示时显示
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // 开发模式下打开开发者工具
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }

  // 当窗口被关闭时，取消引用窗口对象
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Electron 初始化完成后创建窗口
app.whenReady().then(createWindow);

// 当全部窗口关闭时退出
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC 通信处理

// 进度报告函数，传递给处理器
const progressCallback = (progress) => {
  if (mainWindow) {
    mainWindow.webContents.send('processing-progress', progress);
  }
};

// 日志回调函数，传递给处理器
const logCallback = (type, message) => {
  if (mainWindow) {
    mainWindow.webContents.send('processing-log', { type, message });
  }
  // 同时在终端打印
  console.log(`[${type.toUpperCase()}] ${message}`);
};

// 选择文件夹对话框
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: '选择要处理的文件夹'
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, path: null };
  }

  return { success: true, path: result.filePaths[0] };
});

// 选择文件对话框
ipcMain.handle('select-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    title: '选择要处理的文件',
    filters: [
      { name: '媒体文件', extensions: ['mp3', 'wav', 'flac', 'aac', 'm4a', 'mp4', 'avi', 'mov', 'wmv', 'mkv', 'flv', 'webm'] },
      { name: '音频文件', extensions: ['mp3', 'wav', 'flac', 'aac', 'm4a'] },
      { name: '视频文件', extensions: ['mp4', 'avi', 'mov', 'wmv', 'mkv', 'flv', 'webm'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, files: [] };
  }

  return { success: true, files: result.filePaths };
});

// 选择单个视频文件对话框（用于LOGO水印功能）
ipcMain.handle('select-single-video', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    title: '选择视频文件',
    filters: [
      { name: '视频文件', extensions: ['mp4', 'avi', 'mov', 'wmv', 'mkv', 'flv', 'webm'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, file: null };
  }

  return { success: true, file: result.filePaths[0] };
});

// 选择图片文件对话框（用于LOGO和水印）
ipcMain.handle('select-image-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    title: '选择图片文件',
    filters: [
      { name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'] },
      { name: 'PNG图片', extensions: ['png'] },
      { name: 'JPEG图片', extensions: ['jpg', 'jpeg'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, file: null };
  }

  return { success: true, file: result.filePaths[0] };
});

// 使用自定义过滤器选择多个文件
ipcMain.handle('select-files-with-filter', async (event, filters) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    title: '选择文件',
    filters: filters
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, files: [] };
  }

  return { success: true, files: result.filePaths };
});

// 使用自定义过滤器选择单个文件
ipcMain.handle('select-single-file-with-filter', async (event, filters) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    title: '选择文件',
    filters: filters
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, file: null };
  }

  return { success: true, file: result.filePaths[0] };
});

// 扫描文件夹中的媒体文件
ipcMain.handle('scan-media-files', async (event, folderPath) => {
  try {
    const files = await scanMediaFiles(folderPath);
    return { success: true, files };
  } catch (error) {
    console.error('扫描媒体文件时出错:', error);
    return { success: false, error: error.message };
  }
});

// 处理选中的文件
ipcMain.handle('process-selected-files', async (event, filePaths) => {
  try {
    const files = await processSelectedFiles(filePaths);
    return { success: true, files };
  } catch (error) {
    console.error('处理选中文件时出错:', error);
    return { success: false, error: error.message };
  }
});

// 处理MP3文件
ipcMain.handle('process-mp3-files', async (event, { folderPath, outputPath, files, options }) => {
  try {
    const result = await processMp3Files(progressCallback, logCallback, folderPath, outputPath, files, options);
    return { success: true, result };
  } catch (error) {
    console.error('处理MP3文件时出错:', error);
    return { success: false, error: error.message };
  }
});

// 处理视频文件
ipcMain.handle('process-video-files', async (event, { folderPath, outputPath, files, options }) => {
  try {
    const result = await processVideoFiles(progressCallback, logCallback, folderPath, outputPath, files, options);
    return { success: true, result };
  } catch (error) {
    console.error('处理视频文件时出错:', error);
    return { success: false, error: error.message };
  }
});

// 获取ffmpeg状态
ipcMain.handle('check-ffmpeg', async () => {
  try {
    const available = await checkFfmpeg();
    return { success: true, available };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 获取单个文件的详细信息
ipcMain.handle('get-file-details', async (event, { filePath, fileType }) => {
  try {
    const details = await getFileDetails(filePath, fileType);
    return { success: true, details };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 获取默认输出路径
ipcMain.handle('get-default-output-path', async (event, sourcePath) => {
  if (!sourcePath) return { success: false, error: 'Source path is not provided' };
  const outputPath = path.join(sourcePath, 'output');
  try {
    await fs.mkdir(outputPath, { recursive: true });
    return { success: true, path: outputPath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 视频合成处理
ipcMain.handle('compose-videos', async (event, { outputPath, files, options }) => {
  try {
    const result = await composeVideos(progressCallback, logCallback, outputPath, files, options);
    return { success: true, result };
  } catch (error) {
    console.error('合成视频时出错:', error);
    return { success: false, error: error.message };
  }
});

// 片头文件选择
ipcMain.handle('select-intro-file', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: '视频文件', extensions: ['mp4', 'avi', 'mov', 'mkv', 'wmv', 'flv', 'm4v'] },
        { name: '所有文件', extensions: ['*'] }
      ],
      title: '选择片头视频文件'
    });

    if (!result.canceled && result.filePaths.length > 0) {
      return { success: true, filePath: result.filePaths[0] };
    }
    return { success: false, error: '用户取消选择' };
  } catch (error) {
    console.error('选择片头文件时出错:', error);
    return { success: false, error: error.message };
  }
});

// 片尾文件选择
ipcMain.handle('select-outro-file', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: '视频文件', extensions: ['mp4', 'avi', 'mov', 'mkv', 'wmv', 'flv', 'm4v'] },
        { name: '所有文件', extensions: ['*'] }
      ],
      title: '选择片尾视频文件'
    });

    if (!result.canceled && result.filePaths.length > 0) {
      return { success: true, filePath: result.filePaths[0] };
    }
    return { success: false, error: '用户取消选择' };
  } catch (error) {
    console.error('选择片尾文件时出错:', error);
    return { success: false, error: error.message };
  }
});

// 视频片头片尾处理
ipcMain.handle('process-intro-outro', async (event, { outputPath, files, options }) => {
  try {
    await processIntroOutro(progressCallback, logCallback, outputPath, files, options);
    return { success: true };
  } catch (error) {
    console.error('处理视频片头片尾时出错:', error);
    return { success: false, error: error.message };
  }
});

// LOGO水印文件选择
ipcMain.handle('select-logo-file', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg'] },
        { name: '所有文件', extensions: ['*'] }
      ],
      title: '选择LOGO图片文件'
    });

    if (!result.canceled && result.filePaths.length > 0) {
      return { success: true, filePath: result.filePaths[0] };
    }
    return { success: false, error: '用户取消选择' };
  } catch (error) {
    console.error('选择LOGO文件时出错:', error);
    return { success: false, error: error.message };
  }
});

// 水印文件选择
ipcMain.handle('select-watermark-file', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg'] },
        { name: '所有文件', extensions: ['*'] }
      ],
      title: '选择水印图片文件'
    });

    if (!result.canceled && result.filePaths.length > 0) {
      return { success: true, filePath: result.filePaths[0] };
    }
    return { success: false, error: '用户取消选择' };
  } catch (error) {
    console.error('选择水印文件时出错:', error);
    return { success: false, error: error.message };
  }
});

// 视频LOGO水印处理
ipcMain.handle('process-logo-watermark-videos', async (event, { outputPath, files, options }) => {
  try {
    await processLogoWatermark(progressCallback, logCallback, outputPath, files, options);
    return { success: true };
  } catch (error) {
    console.error('处理视频LOGO水印时出错:', error);
    return { success: false, error: error.message };
  }
}); 