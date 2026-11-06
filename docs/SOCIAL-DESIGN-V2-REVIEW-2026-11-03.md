# Estudio social EJ v2: revisión local — 2026-11-03

Esta revisión documenta el código y las pruebas locales de la segunda versión del compositor de posts y carruseles. El problema de partida era la acumulación de títulos, párrafos, viñetas y URLs en espacios insuficientes. La solución combina dirección de arte con Sol, recursos fotográficos independientes, tipografía nativa y comprobaciones de la composición renderizada.

**Estado de esta entrega:** validación local aprobada en las once suites registradas en `data/local-build-work/social-layout-v2-20261103/local-tests.json`. Este documento no acredita todavía una campaña generada con el proveedor real, la configuración efectiva de Secrets de producción ni la publicación de esta versión. Las notas anteriores de despliegue corresponden a sus respectivas entregas y no prueban la publicación de v2.

## Modelos, Fast y coste

Los valores predeterminados del código son **`gpt-6.1-sol`** para contenido/dirección de arte y **`gpt-image-2.5-sunburst`** para imágenes. Se conservan `OPENAI_SOCIAL_MODEL`, `OPENAI_PRESENTATION_MODEL` y `OPENAI_IMAGE_MODEL` como sustituciones explícitas. La configuración declarada por el CMS permite conocer el modelo solicitado; la comprobación local no permite afirmar qué sustituciones hay activas en producción.

El adaptador central `server/openai-service-tier.mjs`, utilizado por `openaiRequest`, solicita `service_tier: "fast"` en `/responses` y `/chat/completions`. Fast conserva el modelo y el esfuerzo de razonamiento elegidos por cada agente. No se añade a `/images/generations`. `OPENAI_TEXT_SERVICE_TIER=default` permite volver al servicio estándar.

La tarifa API de Fast para Sol es **2× la tarifa estándar correspondiente**, no una promesa de que todo el trabajo tarde la mitad. A fecha de consulta, el contexto corto cuesta por millón de tokens USD 2 de entrada / 10 de salida en estándar y USD 4 / 20 en Fast; el contexto largo también duplica su tarifa correspondiente. Las imágenes y las revisiones visuales añaden consumo propio. El coste final depende de tokens, imágenes, calidad y etapas realmente ejecutadas. Referencia: [tarifas oficiales de OpenAI](https://developers.openai.com/api/docs/pricing?latest-pricing=fast).

Se guarda `serviceTier: { requested, served, fallback }` en el resultado de texto y en los metadatos aplicables; el campo original `service_tier` del proveedor se conserva. La revisión visual conserva los niveles servidos por ronda. Si el proveedor no devuelve el nivel efectivo, `served` permanece en `null`. Una solicitud Fast puede ser atendida como estándar, según la respuesta del proveedor; no se deduce el nivel servido a partir de lo solicitado. Solo hay un reintento estándar ante un rechazo explícito del parámetro o valor `service_tier`; autenticación, límites de uso, errores del servidor y timeouts no activan ese reintento. Véase [Fast mode](https://developers.openai.com/api/docs/guides/fast-mode).

La API de imágenes recibe el modelo configurado directamente, `n: 1`, `size: "1536x1024"`, `quality: "medium"` y `output_format: "png"`. Estos parámetros siguen siendo compatibles con Sunburst; no se elevó automáticamente la calidad. La [guía oficial de generación de imágenes](https://developers.openai.com/api/docs/guides/image-generation) diferencia Sunburst, orientado a precisión de edición, de Flare, orientado a generación cotidiana rápida. Esta migración no acredita una comparación real de calidad o latencia entre modelos.

## Compositor canónico y edición

`server/social-compositor.mjs` define `SOCIAL_LAYOUT_VERSION = 2` y una única escena de composición utilizada por la vista previa, el HTML y el PNG. `composeSocialPiece` no escribe archivos ni llama a proveedores. Mide las fuentes reales con OpenType, resuelve cajas, tamaños, saltos de línea y coordenadas, y devuelve la escena junto con los diagnósticos.

El HTML conserva texto SVG real, organizado en grupos `data-field` con su texto original. La edición del CMS usa una capa de entrada y pide una nueva composición al servidor; el navegador no decide por su cuenta los saltos de línea mediante `contenteditable`. El PNG convierte esas mismas líneas en trazados de las mismas fuentes. Kerning y ligaduras se desactivan de forma coherente en ambos caminos para reducir discrepancias. Las fuentes se incorporan al HTML y al material necesario para reconstruir la vista previa.

La escena compacta referencia imágenes por identificadores; los recursos se transfieren aparte cuando hacen falta y se reutilizan en la pestaña. El endpoint `/preview` exige sesión, CSRF y versión vigente, y no guarda cambios ni consume IA. Un usuario autorizado de lectura obtiene la pieza almacenada: un `post` alternativo enviado por ese usuario se ignora. Propietarios y editores pueden probar sus cambios sin guardarlos. El cliente espera las fuentes, cancela solicitudes superadas y evita pintar respuestas de una pieza o versión anterior.

Esta es edición de contenido y controles de diseño dentro del sistema EJ. El HTML descargado conserva texto y elementos gráficos modificables; no incluye un editor autónomo con las funciones de Illustrator o Photoshop. La fotografía sigue siendo una capa rasterizada. Los diseños antiguos conservan su ruta de lectura; no se reescribió masivamente la biblioteca existente.

## Dirección visual y controles

La identidad conserva el logo original, **Libre Caslon Text Italic**, **Bahnschrift Light** y cuatro familias: azul/dorado, blanco editorial, marfil/azul y grafito/dorado. La selección fija del usuario prevalece; el modo combinado coordina familias por pieza. Las imágenes de apoyo del usuario tienen prioridad sobre nuevas fotografías generadas.

Los ocho controles estructurados son `palette`, `spacing`, `headlineScale`, `background`, `imagePosition`, `imageShare`, `align` y `panel`. Admiten fondos sólidos, degradado tonal y resplandor radial acotados a EJ; fotografía izquierda, derecha, superior o de fondo; imagen equilibrada o dominante; alineación izquierda/centrada y panel plano/curvo. Los valores heredados reciben defaults compatibles. Los diez tipos de composición y nueve formatos se comparten con el CMS mediante los módulos de diseño y formatos.

La dirección de arte pide una idea por pieza, jerarquía, espacio, relación intencional entre fotografía y tipografía y ritmo entre piezas. Las composiciones de fondo pueden usar una imagen a sangre y velos direccionales nativos. Se evita convertir cada pieza en un título con un rectángulo pequeño de foto. La generación respeta la cantidad solicitada, de una a veinte piezas, en lugar de añadir piezas para resolver exceso de texto. Se mantienen copy para seis redes, descarga PNG individual, HTML y paquete ZIP opcional.

Las fotografías se plantean como ilustración editorial documental de México salvo indicación distinta en el material: personas y actividades creíbles, proporciones reales, luz y entorno plausibles. El prompt excluye letras, logos, marcas de agua y leyendas; la aplicación añade la identidad como elementos independientes y registra internamente el origen de la imagen sin mostrar una leyenda en la pieza. Las imágenes conservan proporciones mediante recorte, no mediante estiramiento. Un encuadre automático no equivale a detección de rostros o del punto focal.

## Legibilidad y revisión visual

El compositor trabaja sobre un ancho lógico de 1080 px y escala al tamaño de salida. El cuerpo se diseña alrededor de 40 px y mantiene un mínimo lógico de 36 px; pie IA y pie institucional usan al menos 24 px. Son tamaños del archivo de diseño: su lectura final también depende del tamaño al que la red muestre la imagen.

Se comprueban límites reales de las letras, cajas, área segura, colisiones entre texto y elementos de bloqueo, capacidad de la composición y contraste contra las superficies modeladas. Se emplean objetivos de 4.5:1 para texto de cuerpo y 3:1 para títulos grandes. Los degradados de marca se contrastan con sus superficies previstas. Los fondos fotográficos requieren además inspección visual: el diagnóstico no analiza cada píxel de una fotografía para garantizar contraste universal. El formato 9:16 reserva márgenes conservadores de 160 px arriba y 250 px abajo; no son una garantía para todas las interfaces de redes sociales.

Las palabras normales se mantienen completas cuando el rango y el ancho permiten una solución; los tokens largos se dividen para evitar desbordamiento horizontal. Se buscan títulos equilibrados, sin letras aisladas o conectores solitarios. Un mensaje vacío se rechaza. El texto que no cabe se conserva y se diagnostica: no se oculta mediante recorte ni se reduce indefinidamente.

En la generación nueva, las URLs completas salen del texto gráfico y se conservan como fuentes. El prompt lleva el detalle al copy. Si la primera revisión propone una síntesis gráfica, el contenido anterior queda también en `editorialDetails` y en el texto descargable de apoyo. Esto facilita revisar lo condensado; la preservación automática no constituye una comprobación jurídica de que una reformulación conserve todos los matices.

`server/social-review.mjs` envía imágenes de los candidatos renderizados a Sol, junto con contenido y geometría. Revisa **todas las piezas**, en lotes de hasta cinco y como máximo dos lotes simultáneos. Un diagnóstico geométrico inválido impide la aprobación aunque el modelo diga lo contrario. Hay como máximo una pasada correctiva; después solo se vuelven a consultar los hashes sin aprobación vigente. La caché incorpora contenido, PNG, formato, skill, versión de revisión y modelo.

La generación guarda checkpoints de contenido y fotografías antes de las exportaciones finales. Si la revisión no está disponible, el registro queda recuperable con estado pendiente; retomarla no vuelve a generar sus fotografías. El rediseño crea una alternativa y conserva el original; las revisiones de rediseños y ediciones manuales preservan sus palabras. Un cambio de copy conserva los PNG, HTML y aprobaciones de las piezas.

Un texto manual demasiado largo puede guardarse como `needs-adjustment`. La descarga gráfica de esa revisión devuelve 409 hasta resolver el ajuste; el texto continúa disponible. Una revisión del modelo pendiente o rechazada también se comunica mediante estado y controles. La ausencia de errores geométricos no basta para certificar que una pieza tenga una dirección de arte excelente.

## Skills y procedencia

La adaptación cargada por generación, rediseño y revisión es **`ej-social-design-v2`**, en `server/agents/ej-social-design/SKILL.md`. La skill editorial compartida sigue siendo `ej-content-studio-v2` e incorpora el contacto institucional vigente desde el módulo central.

Se conservan fuentes originales, licencias Apache 2.0, avisos y manifiestos de URLs/hashes:

- [Anthropic frontend-design](https://github.com/anthropics/skills/blob/ca45fc496a3436251f191354091d557da31c15b5/skills/frontend-design/SKILL.md), [canvas-design](https://github.com/anthropics/skills/blob/ca45fc496a3436251f191354091d557da31c15b5/skills/canvas-design/SKILL.md) y [webapp-testing](https://github.com/anthropics/skills/blob/ca45fc496a3436251f191354091d557da31c15b5/skills/webapp-testing/SKILL.md), fijados en `ca45fc496a3436251f191354091d557da31c15b5`: jerarquía, composición y procedimiento de inspección de renders.
- [Impeccable](https://github.com/pbakaus/impeccable/tree/9fadc41729c38fd47d7ae622b501558653f9d2e9), fijado en `9fadc41729c38fd47d7ae622b501558653f9d2e9`: módulos `typeset`, `layout`, `colorize` y `polish`, adaptados a tipografía EJ, roles cromáticos, ritmo y acabado.

Los originales archivados son evidencia de procedencia, no instrucciones cargadas sin revisión. No se importaron la identidad de Anthropic, fuentes ajenas, instrucciones incompatibles de producir solo PDF/PNG ni herramientas externas de ejecución. No se instalaron skills globales ni se ejecutaron scripts de los repositorios externos. La skill orienta al agente; el compositor y las pruebas ejecutables verifican el resultado.

## Evidencia local y procedimiento reproducible

El resumen consolidado registra once suites aprobadas. Sus salidas saneadas están junto a `local-tests.json`; el resumen conserva resultados, no credenciales ni entradas reales del cliente.

| Suite | Evidencia principal registrada |
| --- | --- |
| `check-openai-service-tier.mjs` | Wrapper real con proveedor simulado; Fast por defecto, rollback estándar, nivel solicitado/servido, reintento acotado, modelo/razonamiento intactos e imágenes sin tier de texto. |
| `check-social-layout.mjs` | 90 combinaciones de diez composiciones y nueve tamaños, más 24 combinaciones de controles; dimensiones PNG, mínimos tipográficos, saltos, degradados, títulos naturales, CTA, mensaje vacío y contenido imposible diagnosticado. |
| `check-social-studio.mjs` | Trabajo asíncrono; sesión/CSRF/versiones; preview sin persistencia ni IA; recursos compactos reconstruibles; viewer sin edición; checkpoints previos a exportar; texto manual excesivo conservado y descarga 409; revisión de cinco piezas incluidas cuarta/quinta; fallo recuperable sin fotos nuevas; corrección acotada a hashes cambiados; copy sin alterar gráficos; PNG individual y papelera. |
| `check-user-security.mjs` | Contadores persistentes con HMAC, cinco fallos por cuenta, concurrencia, tratamiento separado de IP verificada/transporte compartido, actividad con CSRF, lecturas sin renovar idle, revocación efectiva y cap absoluto inmutable. |
| `check-auth-security.mjs`, `check-security.mjs`, `check-cms-csrf.mjs`, `check-cms-content.mjs` | Regresiones de acceso, seguridad y guardado del CMS. |
| `check-documents.mjs`, `check-presentations.mjs` | Texto y documentos editables, fuentes, membrete multipágina y exportaciones existentes conservados. |
| `check-site-optimization.mjs` | Regresión local de 18 páginas, 17 canónicas, 24 vínculos de configuración, rutas privadas y rango de video; no sustituye una medición PageSpeed en producción. |

La suite de composición dejó ejemplos en `data/local-build-work/social-layout-v2-pTwFws/` y la suite social en `data/local-build-work/social-check-6lIl5t/`. Se inspeccionaron directamente los PNG `screenshot-shaped-synthesized.png` y `portrait-full-bleed-editorial.png`: el primero presenta la síntesis en cajas separadas y el segundo muestra texto nativo sobre fondo a sangre con velos. Usan una imagen geométrica ficticia como recurso de prueba; no son imágenes creadas por GPT Image 2.5 ni una campaña real.

Como comprobación independiente adicional, una VM con DOM/reloj sintéticos verificó que un 401 tardío de un poll antiguo no invalida una nueva sesión, que bfcache recupera el seguimiento con GET sin renovar idle, que un input no confiable se ignora y que input/click/change legítimos se rastrean. No se hicieron intentos contra cuentas reales ni producción para esa comprobación.

Para repetir las pruebas, ejecutar desde la raíz `node scripts/check-openai-service-tier.mjs`, `node scripts/check-social-layout.mjs` y `node scripts/check-social-studio.mjs`, y después las suites de regresión pertinentes. Las pruebas sociales crean cwd y datos temporales aislados, con proveedor simulado; no necesitan consumir OpenAI. La suite de seguridad levanta un backend local con cuentas ficticias. Conservar el JSON de resultados y revisar los PNG de casos límite antes de dar por aprobada una modificación del compositor.

## Comprobaciones pendientes y límites

La aceptación visual final necesita una campaña real autorizada que incluya pieza individual, carrusel, párrafos largos, fondo fotográfico, una paleta clara y una oscura. Debe compararse preview con PNG/HTML descargados, revisar todas las piezas a tamaño móvil, examinar recortes, matices del texto y copy por red, y comprobar modelo/nivel servido efectivos. No existe una garantía de mejor diseño por cambiar de modelo o concatenar más skills.

El sistema admite composiciones y controles definidos, no generación arbitraria de vectores, retoque de capas de Photoshop ni una maqueta libre ilimitada. La revisión automática puede equivocarse y la pasada de corrección está acotada. Si falla una etapa, se conserva lo alcanzado, pero la revisión puede consumir tokens al retomarse. Una imagen 4K exportada tampoco convierte la fotografía fuente de 1536 × 1024 en detalle nativo 4K.

Los formatos son recomendaciones del CMS; un PNG no es un Reel o video y el sistema no publica por sí mismo en redes. El almacenamiento de seguridad usa SQLite local y no constituye un rate limiter distribuido. La validación local y las fuentes oficiales permiten revisar esta entrega; la disponibilidad por cuenta, el coste real, la latencia, la estética final y el comportamiento desplegado requieren sus comprobaciones correspondientes.
