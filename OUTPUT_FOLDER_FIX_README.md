# 输出文件夹自动更新问题修复说明

## 🐛 问题描述

在使用"视频添加LOGO水印"功能时，当选择新文件后，输出设置中的"输出文件夹"路径没有自动更新为当前选中文件的同级目录。这导致用户需要手动重新设置输出路径，影响使用体验。

## 🔍 问题分析

### 1. 原有逻辑问题
- 选择文件时，只在 `!this.outputFolder.value` 时才设置默认输出路径
- 如果之前已经设置过输出文件夹，就不会再更新
- LOGO水印模式每次选择新文件时应该更新输出路径

### 2. 代码位置
- `src/js/renderer.js` 中的 `selectFiles` 函数
- `src/js/renderer.js` 中的 `replaceFilesInCurrentTab` 函数

## 🛠️ 修复方案

### 1. 修改 `selectFiles` 函数
```javascript
// 更新当前文件夹为第一个文件的目录
const firstFilePath = files[0];
this.currentFolder = path.dirname(firstFilePath);

// 对于LOGO水印模式，每次选择新文件时都更新输出路径
// 对于其他模式，只在没有设置输出路径时设置默认路径
if (this.currentFileType === 'logo-watermark' || !this.outputFolder.value) {
    const defaultOutputPath = await ipcRenderer.invoke('get-default-output-path', this.currentFolder);
    if (defaultOutputPath.success) {
        this.outputFolder.value = defaultOutputPath.path;
        this.addLog('info', `📁 输出路径已更新: ${defaultOutputPath.path}`);
    }
}
```

### 2. 修改 `replaceFilesInCurrentTab` 函数
```javascript
// 如果是LOGO水印模式且有文件，自动加载到视频预览器
if (this.currentFileType === 'logo-watermark' && targetFiles.length > 0) {
    this.loadVideoPreview(targetFiles[0]);
    
    // 更新输出路径为当前文件的同级目录
    const currentFilePath = targetFiles[0];
    const currentFolder = path.dirname(currentFilePath);
    this.currentFolder = currentFolder;
    
    const defaultOutputPath = await ipcRenderer.invoke('get-default-output-path', currentFolder);
    if (defaultOutputPath.success) {
        this.outputFolder.value = defaultOutputPath.path;
        this.addLog('info', `📁 输出路径已更新为当前文件目录: ${defaultOutputPath.path}`);
    }
}
```

## 📝 修复后的效果

1. **LOGO水印模式**：每次选择新文件时，输出文件夹会自动更新为当前文件的同级目录
2. **其他模式**：保持原有逻辑，只在没有设置输出路径时设置默认路径
3. **用户体验**：无需手动重新设置输出路径，提高工作效率

## 🔧 使用方法

1. 选择"视频添加LOGO水印"标签
2. 点击"选择文件"选择第一个视频文件
3. 输出文件夹会自动设置为该文件的同级目录下的 `output` 文件夹
4. 如果选择另一个文件，输出文件夹会自动更新为新文件的同级目录

## ⚠️ 注意事项

- 修复后，LOGO水印模式每次选择新文件都会自动更新输出路径
- 其他模式（MP3压缩、视频转换等）保持原有行为
- 输出路径格式：`[文件所在目录]/output`

## 📁 修改的文件

1. `src/js/renderer.js` - 修改文件选择逻辑和文件替换逻辑

## 🎯 修复验证

修复完成后，可以按以下步骤验证：

1. 选择"视频添加LOGO水印"标签
2. 选择第一个视频文件，观察输出文件夹是否自动设置
3. 选择另一个视频文件，观察输出文件夹是否自动更新
4. 检查日志中是否显示"输出路径已更新"信息

修复完成！现在LOGO水印功能在选择新文件时会自动更新输出文件夹路径。
