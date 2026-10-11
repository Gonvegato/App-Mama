# Cuaderno de viajes

Organizador de viajes para mamá: un programa de Windows y la misma aplicación en el móvil (iPhone y Android), con los datos sincronizados en la nube.

Cada viaje tiene **portada, fechas y viajeros**, y estas secciones:

| Sección | Qué hace |
|---|---|
| **Resumen** | Cuenta atrás, lo próximo que toca, el tiempo previsto (hasta 16 días vista), mapa en miniatura y notas. |
| **Itinerario** | El viaje día a día: vuelos, entrada y salida del hotel, actividades, lugares asignados a cada día y planes propios con hora. |
| **Mapa** | Lugares por categorías, alojamientos, vuelos (con su curva real) y rutas. Buscador de sitios, «Añadir punto» tocando el mapa, filtro por día, «Cómo llegar» con Google Maps o Apple Maps y la ubicación actual. |
| **Reservas** | Vuelos (con buscador de aeropuertos), alojamientos, trenes, autobuses, barcos, coches de alquiler, entradas y restaurantes, con su código de reserva (se copia con un toque), precio y billetes adjuntos. |
| **Documentos** | Billetes, tarjetas de embarque, entradas, guías, seguros, fotos y enlaces. Vista previa de PDF e imágenes, descarga y arrastrar y soltar. |
| **Correos** | Busca en Gmail los correos del viaje (búsqueda preparada con el destino, las fechas y los códigos de las reservas) y los guarda en el viaje junto con sus adjuntos. |
| **Maleta** | Lista con plantillas (esencial, ropa, aseo, playa, frío, avión), grupos propios y copiar la maleta de otro viaje. |
| **Gastos** | Presupuesto, gastos por categorías, precios de las reservas sumados solos y cuentas entre viajeros. |

Además: 6 temas (claro y oscuro), tres tamaños de letra, funciona sin conexión con lo último que se cargó (los cambios se suben al volver la conexión), imprimir o guardar en PDF el viaje, duplicar viajes y copias de seguridad.

---

## Puesta en marcha (una sola vez, unos 30 minutos)

### 1. La base de datos (Supabase, plan gratuito)

1. Crea una cuenta en [supabase.com](https://supabase.com) y un proyecto nuevo (elige una región de Europa). Apunta la contraseña de la base de datos aunque no la vayas a usar.
2. En el panel del proyecto abre **SQL Editor**, pega el contenido de [`backend/supabase.sql`](backend/supabase.sql) y pulsa **Run**. Crea las tablas, la seguridad (cada usuario solo ve lo suyo) y el espacio privado para los archivos.
3. **Authentication → Users → Add user → Create new user**: correo y contraseña de tu madre. Si aparece la opción de confirmar automáticamente el usuario, márcala.
4. En los ajustes de **Authentication**, desactiva **«Allow new users to sign up»** para que nadie más pueda crearse una cuenta.
5. Copia dos datos (están en el botón **Connect** de arriba y en **Settings → API Keys**):
   - la **URL del proyecto** (`https://xxxx.supabase.co`)
   - la **clave pública** (*publishable key*, o la *anon key* antigua). **Nunca** la *secret* / *service_role*.

### 2. GitHub (web para el móvil y programa de Windows)

1. En este repositorio: **Settings → Secrets and variables → Actions → pestaña Variables → New repository variable**:
   - `SUPABASE_URL` → la URL del proyecto
   - `SUPABASE_KEY` → la clave pública
2. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. **Actions →** ejecuta **«Web para el móvil»** y **«Programa de Windows»** (botón *Run workflow*). Tardan unos minutos.

Con eso la app ya sabe a qué base de datos conectarse y tu madre solo tendrá que poner su correo y contraseña.

### 3. En el ordenador de tu madre

1. Ve a **Releases** (columna derecha del repositorio) y descarga el `.exe` más reciente.
2. Ábrelo. Como el programa no está firmado digitalmente, Windows puede mostrar «Windows protegió su PC»: **Más información → Ejecutar de todas formas**.
3. Se crea un acceso directo «Cuaderno de viajes» en el escritorio. Entra con su correo y contraseña.

Para actualizar el programa en el futuro: descargar el `.exe` nuevo e instalarlo encima (los datos están en la nube, no se pierden).

### 4. En el móvil

La dirección es `https://<tu-usuario-en-minúsculas>.github.io/<repositorio>/` (por ejemplo `https://gonvegato.github.io/app-mama/`). En el programa de escritorio, **Ajustes → Usarla en el móvil** muestra un código QR para abrirla con la cámara.

- **iPhone:** abrir en Safari → Compartir → **Añadir a pantalla de inicio**.
- **Android:** abrir en Chrome → menú ⋮ → **Añadir a pantalla de inicio** / **Instalar aplicación**.

### 5. Gmail (opcional, recomendado)

La conexión con Gmail se hace con un pequeño script de Google que se instala **en la cuenta de Gmail de tu madre** y solo puede **leer** (no envía ni borra nada):

1. Con su cuenta, entra en [script.google.com](https://script.google.com) → **Nuevo proyecto**.
2. Pega el contenido de [`backend/gmail-ayudante.gs`](backend/gmail-ayudante.gs) y cambia la línea `CLAVE` por una frase secreta.
3. Guarda, elige la función **probar** y pulsa **Ejecutar**. Acepta los permisos. Si sale «Google no ha verificado esta aplicación»: *Configuración avanzada → Ir a … (no seguro)*; es normal, el script es vuestro.
4. **Implementar → Nueva implementación** (*Deploy → New deployment*) → tipo **Aplicación web** (*Web app*). *Ejecutar como*: **Yo** (*Me*). *Quién tiene acceso*: **Cualquier usuario** (*Anyone*). Copia la URL que termina en `/exec`.
5. En la app: **Ajustes → Correo (Gmail)** → pega la URL y la clave → **Guardar y probar**. Se guarda en la nube, así que en el móvil ya funciona.

El ayudante también sirve para abrir **enlaces cortos** de Google Maps (`maps.app.goo.gl`) y Apple Maps (`maps.apple`) al importar.

### 6. Que la base de datos no se «duerma»

El plan gratuito de Supabase **pausa el proyecto tras 7 días sin uso**. El flujo **«Mantener activa la base de datos»** hace una consulta mínima cada 3 días (usa las mismas variables del paso 2).

Ojo: GitHub **desactiva las tareas programadas de un repositorio público tras 60 días sin actividad** en el repositorio. Si te llega un aviso, entra en *Actions → Mantener activa la base de datos → Enable workflow*. Si aun así el proyecto se pausara, se reactiva desde el panel de Supabase con *Restore project* (los datos no se pierden).

---

## Importar lugares y rutas al mapa

En **Mapa → Importar** hay una pestaña «Cómo exportar» con estas mismas instrucciones.

- **Google Maps, un lugar o una ruta:** Compartir → Copiar enlace → pegarlo en «Enlaces» (se pueden pegar muchos a la vez). Las rutas con paradas se añaden como lugares más una línea que los une en orden.
- **Google Maps, listas guardadas:** [Google Takeout](https://takeout.google.com) → solo «Guardado» (y «Mapas (tus sitios)») → importar los `.csv` de cada lista o `Sitios guardados.json`. Las listas no traen coordenadas: la app busca cada sitio por su nombre (uno por segundo) y deja revisar el resultado antes de añadirlo.
- **Google My Maps:** menú ⋮ → Descargar KML → importar el `.kml`/`.kmz` (conserva capas, notas, rutas y colores).
- **Apple Maps:** Compartir → Copiar en cada lugar o ruta y pegar los enlaces. **Apple Maps no permite exportar guías completas**, así que hay que compartir los lugares uno a uno.
- **GPX** (Komoot, Wikiloc, relojes…) y **GeoJSON** también se importan.

---

## Límites y decisiones honestas

- **Duración de los trayectos:** no se calcula, porque las horas de salida y llegada son locales y pueden estar en husos horarios distintos; se muestra la distancia.
- **Estado de los vuelos en directo:** no está incluido (los servicios fiables son de pago).
- **El tiempo:** solo hay previsión real hasta 16 días vista (Open-Meteo). Para viajes más lejanos no se muestra nada en vez de inventar.
- **Búsqueda de lugares:** usa OpenStreetMap (Nominatim), que solo permite búsquedas al pulsar «Buscar» y una por segundo. Por eso no autocompleta mientras se escribe.
- **Espacio:** el plan gratuito de Supabase incluye 1 GB para archivos y 500 MB de base de datos; las fotos se reducen antes de subirlas. Archivos de hasta 50 MB.
- **Sin conexión:** se ve todo lo ya cargado (incluidos los trozos de mapa visitados en el móvil), pero los documentos y correos guardados necesitan conexión para abrirse.

---

## Para desarrollar

```bash
npm install            # dependencias (Electron, pruebas)
npm test               # pruebas de los importadores
npm run serve          # la web en http://localhost:5173
npm start              # el programa de escritorio
```

- `web/` — la aplicación (HTML, CSS y módulos JS sin paso de compilación; Preact + htm, Leaflet, supabase-js).
- `desktop/` — envoltorio de Electron para Windows.
- `backend/` — script SQL de Supabase y ayudante de Gmail.
- `.github/workflows/` — instalador de Windows, publicación de la web y mantenimiento.

Créditos de datos y librerías: mapas © colaboradores de OpenStreetMap y CARTO; búsqueda Nominatim y Photon; tiempo Open-Meteo (CC BY 4.0); aeropuertos OurAirports (dominio público); iconos Lucide (ISC); letra Newsreader (OFL); Preact (MIT), htm (Apache-2.0), Leaflet (BSD-2), JSZip (MIT), supabase-js (MIT) y qrcode-generator (MIT).
