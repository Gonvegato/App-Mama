// Puente mínimo entre la ventana y el programa: indica que es la versión de escritorio
// y, en el modo USB, permite guardar copias de los archivos en el propio USB.
const { contextBridge, ipcRenderer } = require('electron');

const usb = {
  info: () => ipcRenderer.invoke('usb:info'),
  write: (rel, data) => ipcRenderer.invoke('usb:write', rel, data),
  stat: rel => ipcRenderer.invoke('usb:stat', rel),
  remove: rel => ipcRenderer.invoke('usb:remove', rel),
  move: (from, to) => ipcRenderer.invoke('usb:move', from, to),
  getIndex: () => ipcRenderer.invoke('usb:index:get'),
  setIndex: idx => ipcRenderer.invoke('usb:index:set', idx),
  open: rel => ipcRenderer.invoke('usb:open', rel),
};

contextBridge.exposeInMainWorld('cuaderno', { desktop: true, usb });
