// Puente mínimo entre la ventana y la app: solo indica que es la versión de escritorio.
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('cuaderno', { desktop: true });
