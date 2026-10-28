# Firma de correo – Expresión Jurídica Consultores

## Contenido
- `Firma de Correo.dc.html` – plantilla visual (réplica del PDF). Props: nombre, cargo, telefono, correo, direccion1, direccion2.
- `Panel Firma.dc.html` – generador: formulario, vista previa, HTML para correo (600×220 px), copiar/descargar HTML y PNG. Guarda los datos en localStorage.
- `support.js` – runtime requerido por los archivos `.dc.html` (mantener junto a ellos).
- `assets/firma-fondo.png` – diseño completo sin texto (3132×1151), usado por la plantilla y el PNG.
- `assets/email/logo.png`, `assets/email/fondo-derecha.png` – imágenes para la firma HTML. **Súbelas a un servidor público** y pon esa URL en el campo "URL pública de las imágenes".
- `assets/fonts/` – fuentes (subconjuntos extraídos del PDF: Libre Caslon Text Italic y Bahnschrift).

## Integración
1. Copia toda la carpeta a tu CMS manteniendo la estructura de rutas relativas.
2. Abre `Panel Firma.dc.html` (iframe o página) para el generador.
3. Para generar el HTML desde tu backend, la función `buildEmail()` dentro de `Panel Firma.dc.html` (script del componente) devuelve la tabla HTML lista para correo; las constantes `LINES`, `PW`, `PH` contienen la geometría del PDF.

## Notas
- Gmail ignora fuentes personalizadas (se usa Georgia/Arial). Outlook en Windows y Apple Mail respetan Bahnschrift.
- Las fuentes son subconjuntos: solo contienen los caracteres del PDF. Usa las fuentes completas si necesitas todo el alfabeto.
- Para fidelidad exacta en cualquier cliente, usa el PNG.
