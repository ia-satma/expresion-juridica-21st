# Skills de diseño y formatos del estudio EJ — 2026-11-03

El agente de posts/carruseles usa una adaptación revisada de las skills oficiales de Anthropic **frontend-design** y **canvas-design**. Se mantiene **gpt-6.1-sol** para contenido/dirección de arte y **gpt-image-2** para fotografías; incorporar una skill no implica cambiar de proveedor ni usar Claude.

## Procedencia y aplicación

Fuentes oficiales: [frontend-design](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md) y [canvas-design](https://github.com/anthropics/skills/blob/main/skills/canvas-design/SKILL.md). Versión fijada: `ca45fc496a3436251f191354091d557da31c15b5`, consultada el 2026-11-03. Los cuatro archivos originales de instrucciones/licencia conservan sus hashes en `server/agents/third-party/anthropic-design/`. Se mantienen las licencias Apache 2.0 y la atribución. No se instalaron fuentes, scripts ni dependencias del repositorio externo.

La adaptación `server/agents/ej-social-design/SKILL.md`, ID `ej-social-design-anthropic-v1`, se carga realmente en las solicitudes de generación y rediseño social. Los originales quedan como referencia de procedencia; no se concatenan sin revisión. Se adaptaron composición según el tema y audiencia, jerarquía, espacio negativo, una idea dominante, texto gráfico breve, ritmo del carrusel y revisión final. El rediseño sigue recibiendo hasta tres imágenes reales del diseño anterior y conserva original, palabras, fotos y copy.

El encargo EJ prevalece sobre las preferencias genéricas de las skills: logo original, Libre Caslon Text Italic, Bahnschrift Light, cuatro paletas coordinadas, HTML editable y PNG consistente. No se adoptan las instrucciones de producir solo PDF/PNG, descargar otras fuentes ni ignorar restricciones del cliente. Documentos y presentaciones conservan sus reglas editoriales propias.

## Formatos disponibles

El selector pasó de cuatro a nueve medidas. Una ayuda cambia con la selección y muestra redes/usos recomendados. Un módulo compartido define medidas, etiquetas y márgenes para el navegador, el validador del servidor y el render.

| Formato | Píxeles | Uso recomendado en el CMS |
|---|---|---|
| Vertical 4:5 | 1080 × 1350 | Instagram/Facebook, publicación y carrusel |
| Cuadrado 1:1 | 1080 × 1080 | Instagram/Facebook/LinkedIn, publicación |
| Vertical 9:16 | 1080 × 1920 | Historias Instagram/Facebook, carrusel de fotos TikTok |
| Horizontal 1.91:1 | 1080 × 566 | Publicación horizontal Instagram/Facebook |
| LinkedIn cuadrado | 1200 × 1200 | Publicación/anuncio de imagen |
| LinkedIn horizontal | 1200 × 628 | Publicación/anuncio de imagen |
| Pinterest 2:3 | 1000 × 1500 | Pin de imagen |
| YouTube HD 16:9 | 1280 × 720 | Miniatura ligera |
| YouTube 4K 16:9 | 3840 × 2160 | Miniatura en la resolución actualmente recomendada |

Referencias primarias consultadas: [especificaciones de LinkedIn](https://www.linkedin.com/help/lms/answer/a420758), [Pinterest](https://help.pinterest.com/en/business/article/pinterest-product-specs), [miniaturas de YouTube](https://support.google.com/youtube/answer/72431?hl=en) y [guía de carruseles de imagen de TikTok](https://ads.tiktok.com/business/library/Image_Ads_Carousel_Ads_Playbook.pdf). Las guías publicitarias respaldan esas medidas y proporciones; su extensión a publicaciones orgánicas es una recomendación de diseño del CMS, no una regla universal de la plataforma. La variante HD de YouTube es una alternativa compatible con su ancho mínimo; la recomendación actual de su ayuda es 3840 × 2160. No se presenta un PNG como video o Reel ni se publica automáticamente en redes.

El formato 9:16 deja márgenes conservadores de 160 px arriba y 250 px abajo para el contenido esencial. Son una decisión del diseño EJ, no una garantía sobre todas las superposiciones de cada red. Los fondos cubren el lienzo completo. Las nuevas resoluciones usan coordenadas proporcionales para mantener el tamaño visual de los textos y el encuadre; las fotografías conservan su proporción mediante recorte, sin estiramiento. Los cuatro identificadores anteriores siguen admitidos.

Los posts individuales ya no muestran `01 / 01` ni un ordinal editorial sin significado. El encabezado breve puede permanecer vacío. Los carruseles sí conservan posición y secuencia. Paletas por pieza, exportaciones individuales y papelera/restauración de la entrega anterior continúan disponibles.

## Validación

- Prueba social con proveedor simulado: la adaptación llega a generación y rediseño, modelos correctos, referencias visuales, original/copy conservados, nueve dimensiones PNG reales y HTML editable correspondiente.
- Escala tipográfica proporcional hasta 4K, márgenes 9:16, numeración solo para carrusel y encabezado vacío comprobados.
- Trabajo asíncrono, descarga PNG individual, ediciones sin IA, carga de imágenes del usuario antes de generar, papelera/restauración, versión, sesión y CSRF comprobados.
- Suites locales de seguridad, autenticación, editor de contenido y CSRF correctas. Navegador local con backend real aislado: nueve opciones, recomendación dinámica, generación vertical completa, preview editable y ancho móvil 390/documento375 sin desbordamiento.

Las generaciones de QA usan datos ficticios y un proveedor simulado; verifican integración, controles y render, y no acreditan la calidad de una nueva respuesta real de Sol. No se gastaron créditos ni se borraron registros reales del cliente para probar.

La integración remota solo sustituye archivos propios después de verificar sus hashes contra `f58ead8`; no reemplaza `server/index.mjs`, `.replit`, bases de datos ni Secrets.

Publicación final observada **Live**. Las cinco suites también pasaron en Replit **Node 20.20.0**. La integración comprobó 16 archivos y creó el respaldo de sesión `/tmp/ej-anthropic-design-backup-185c4732`; este respaldo no sustituye una copia duradera integral.

En producción, la sesión existente sigue funcionando y los recursos responden 200 con CSP e interfaz `20261103-design5`. El CMS muestra nueve opciones y la ayuda de Pinterest/YouTube se actualiza al elegir. Modelos observados: `gpt-6.1-sol` y `gpt-image-2`. Escritorio 1284/documento1269 y móvil390/documento375, sin desbordamiento; cero errores/advertencias de consola observados. Se abrió una pestaña propia para no alterar el documento que el usuario tenía abierto.

Se revisaron 137 archivos fuente de texto versionados o incluidos en esta entrega sin detectar patrones conocidos de claves. El alcance no garantiza identificar cualquier tipo de secreto. No se copiaron valores de cookies, claves, cuerpos de consultas ni usuarios reales en la evidencia.

Evidencia saneada: `data/local-build-work/anthropic-design-20261103/` y captura `ej-skills-formatos-publicado.png`. La comprobación en producción fue de lectura y selección de opciones: ninguna generación de pago ni eliminación de registros del cliente.
