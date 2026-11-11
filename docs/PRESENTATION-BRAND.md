# Presentaciones de Expresión Jurídica

La marca aprobada por Alejandro el 2 de noviembre de 2026 es la de **EJ-MANUAL y la tarjeta**, no la variante Manrope de ID-BOOK.

## Perfil único

`server/presentation-brand.mjs` define `ej-manual-2026` para todas las plantillas. Azul `#141A3A`, azul noche `#0B0F1E`, dorado `#D9BC88`, gris `#DADADA` y papel `#F4F4F4`. Referencias: EJ-MANUAL, páginas 22, 24, 25 y 27; tarjeta y hoja membretada.

Los títulos usan Libre Caslon Text Italic; el cuerpo usa Bahnschrift Light. El logo procede de `sitio/marca/logo-original.png`, conserva proporción y colores. La portada retoma el panel azul de la tarjeta. El resto usa márgenes amplios, marca de agua tenue y un hilo dorado con quiebre y punto final. Corporativa, editorial y azul institucional cambian composición, conservando este perfil. La variante sin logo omite también las marcas de agua.

Una escena común define geometría, textos, imágenes y diagramas para PPTX y PNG/PDF. PDF y PNG usan los trazos reales de las fuentes para evitar sustituciones del servidor. PowerPoint mantiene textos, formas y diagramas editables, y lleva dos fuentes EOT incrustadas. La compatibilidad con fuentes incrustadas depende del visor; el PDF conserva la apariencia.

## Fuentes privadas del servidor

Los binarios TTF/EOT quedan fuera del repositorio y fuera de las rutas públicas. Deben existir en `server/assets/ej-brand/` en el servidor:

- `bahnschrift-light.ttf` y `.eot`: fuente completa suministrada por el usuario en `Bahnschrift-Font-Family.zip`; instancia de `wght=300`, `wdth=100`. Permiso de incrustación editable `fsType=8`.
- `libre-caslon-italic.ttf` y `.eot`: [Libre Caslon Text](https://github.com/impallari/Libre-Caslon-Text), distribución oficial del autor, licencia SIL OFL incluida junto a los activos. Se usa el archivo completo; el subconjunto del manual omite caracteres necesarios.
- `font-metrics.json`: avances por carácter para el ajuste de líneas.

Después de reemplazar los TTF, ejecutar `python3 scripts/build-presentation-fonts.py` con FontTools. Reconstruye las métricas y partes EOT sin alterar los permisos de incrustación. No usar los subconjuntos de los PDF para textos arbitrarios.

## Generación y entradas

Contenido: `gpt-6.1-sol`, configurable con `OPENAI_PRESENTATION_MODEL`, con `service_tier: "fast"` solicitado para llamadas de texto. Imágenes: `gpt-image-2.5-sunburst`, configurable con `OPENAI_IMAGE_MODEL`. La clave de texto se lee de `OPENAI_API_KEY` en Secrets; opcionalmente `OPENAI_IMAGE_API_KEY` reemplaza la clave solo para imágenes. Ninguna clave se entrega al navegador. La búsqueda web es opcional mediante Responses API; se muestran fuentes consultadas. Sin clave, el resultado queda identificado como prueba sin IA.

Se admiten hasta 20 documentos PDF con texto, DOCX, TXT o Markdown y 10 imágenes PNG/JPG/WebP. Máximo 100 MB por archivo y 200 MB por solicitud. El texto combinado admite 120 000 caracteres; PDF, hasta 150 páginas. No se ofrece OCR. Las copias temporales se eliminan al concluir o fallar la solicitud. Las imágenes aportadas tienen prioridad; se generan como máximo cuatro imágenes de IA. Los diagramas se dibujan de forma nativa sin llamadas al modelo de imágenes.

La generación no exige clasificación, confirmaciones del material ni bloqueo por indicadores. Conserva autenticación, permisos de edición y CSRF. Los archivos generados y su historial son accesibles solo a usuarios autorizados del CMS.

PPTX, PDF y PNG en ZIP se generan según la selección; las vistas previas se conservan para el historial. Las presentaciones anteriores mantienen sus descargas y no se rediseñan automáticamente.

Cada presentación nueva puede añadir dos láminas institucionales fijas: `presentation-opening.jpeg` abre la presentación y `presentation-closing.jpeg` la cierra. El interruptor **Incluir diapositiva de entrada y cierre** viene activado y permite desactivarlas cuando se necesita solo el contenido. El número indicado en el formulario corresponde al contenido generado; cuando se activa, el resultado final incluye esas dos láminas adicionales. Se conservan como imágenes editables en PowerPoint y como páginas completas en PDF/PNG. El historial expone el total y marca si incluye apertura y cierre.

## Comprobación

El agente carga `server/agents/ej-content-studio/SKILL.md` en cada solicitud de contenido. La dirección fotográfica admite personas y usa México contemporáneo por defecto; una indicación geográfica expresa del material tiene prioridad. El estilo es documental y realista. Las fotos generadas se mantienen como objetos independientes y se registran internamente, sin añadir una leyenda visible al diseño. Las fotos aportadas tampoco reciben una leyenda. Fotos y logotipos son objetos independientes que se pueden mover o reemplazar en PowerPoint.

`node scripts/check-presentations.mjs` usa una API simulada y verifica lectura de documentos, marca, fuentes incrustadas, formatos, precedencia de imágenes aportadas, límite de imágenes de IA y fuentes web. No consume créditos de OpenAI.

Comprobar además el formulario en navegador, los acentos y la apertura del PPTX en un visor de presentaciones. Solo se modifican el módulo y los estilos del generador; el sitio público conserva su scroll y animaciones.
