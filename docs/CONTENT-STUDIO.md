# Estudio editorial del CMS

Rutas de la aplicación: `/admin/#presentations`, `/admin/#posts` y `/admin/#documents`.

## Identidad y agente

Todos los módulos usan el perfil `ej-manual-2026`, el logotipo original y las fuentes institucionales aprobadas. El agente carga la skill versionada `server/agents/ej-content-studio/SKILL.md` mediante `server/editorial-skill.mjs`. Modelo de texto predeterminado: `gpt-6.1-sol`; fotografías: `gpt-image-2`. La clave `OPENAI_API_KEY` permanece en Secrets, en el servidor. `OPENAI_SOCIAL_MODEL` puede configurar el texto social explícitamente; los documentos comparten `OPENAI_PRESENTATION_MODEL`.

Las imágenes se plantean como fotografía documental contemporánea de México, con personas cuando son pertinentes, salvo que el material indique otro lugar. Las fotografías de IA se identifican como tales. No se inventan credenciales, resultados, datos de contacto ni citas legales. Las instrucciones contenidas en los insumos se tratan como datos. No hay formulario de clasificación ni bloqueo por categoría del material.

## Posts y carruseles

`server/social-generator.mjs` produce una pieza o carruseles de hasta 20 piezas, con ocho composiciones y cuatro proporciones. Las fotos aportadas tienen prioridad. Generar fotos de IA y consultar la web son acciones opcionales; las fuentes consultadas se conservan.

El mismo esquema de composición produce PNG y HTML portátil con texto real editable, elementos independientes, fuentes y fotografías incrustadas. El CMS permite editar campos o texto sobre el lienzo, cambiar composición y guardar sin llamar a la IA. La actualización de copy con Sol es una acción explícita. Se generan textos distintos para Instagram, Facebook, LinkedIn, X, Threads y TikTok. Se descargan las piezas por separado o en ZIP con los HTML y el copy.

## Documentos con membrete

`server/document-generator.mjs` conserva por defecto el texto completo pegado por el usuario. El modo «Organizar con Sol» es opcional y explícito. Los resultados se editan en Tiptap; guardar modificaciones reconstruye Word y PDF sin una llamada de IA.

La plantilla procede de `Hoja membretada.pdf` suministrada por el usuario. `scripts/build-letterhead.py` elimina únicamente el texto de muestra y conserva la identidad y los datos de contacto. El PDF usa el membrete vectorial y texto seleccionable con fuentes incrustadas. El DOCX usa párrafos, títulos, listas y énfasis nativos, dos fuentes incrustadas y un membrete independiente en la cabecera de cada página. El texto no se rasteriza ni se protege contra edición. La paginación de Word puede variar según el visor y las ediciones del usuario.

Tiptap se usa solo como editor abierto, con StarterKit. Los exportadores DOCX y PDF son propios: no requieren conversión ni suscripción Pro de Tiptap. El paquete de navegador está versionado en `public/admin/vendor/tiptap.js`; `npm run build:editor` lo reconstruye y actualiza sus avisos de licencia. Las fuentes y la plantilla del editor se sirven a través de rutas autenticadas; nunca se expone una clave de API. PdfCraft no se añadió: su motor Rust y su enfoque de edición de PDF no son necesarios para este flujo.

## Historial y procesos

La generación y el guardado usan trabajos asíncronos, con progreso, identificador y recuperación al volver al apartado. La metadata, los trabajos y sus referencias se conservan en App Storage bajo el entorno correspondiente. Los ficheros locales sirven para desarrollo; el historial no depende de la memoria de un proceso. Se incluyen comprobaciones de versión para evitar sobreescribir una edición más reciente.

Las rutas requieren sesión y permisos de editor para modificar; las mutaciones comprueban CSRF. Los HTML de posts se muestran en un iframe sin scripts. Los archivos y fuentes no son públicos. Publicar en cuentas de redes sociales está fuera de este flujo.

El cliente obtiene el token CSRF vigente de su cookie al enviar cada mutación. Así puede guardar aunque otra pestaña haya renovado el token al comprobar la sesión; la validación del servidor se mantiene. Los documentos organizados con IA conservan el título solicitado como primer encabezado, aun si el modelo propone otra sección inicial.

Las fotografías de PowerPoint usan la proporción real de la imagen para calcular su recorte. El marco puede ser vertical, horizontal o cuadrado sin estirar la foto. `server/presentation-images.mjs` corrige también el recorte de los PPTX anteriores al descargarlos, conservando sus imágenes originales, fuentes y objetos editables. No altera el archivo guardado ni consume otra llamada de IA.

## Validación

- `node scripts/check-presentations.mjs`: entradas, formatos, fuentes, fotos aportadas primero, límite técnico de imágenes, contexto México y pies nativos en PPTX.
- `node scripts/check-social-studio.mjs`: generación asíncrona, autorización, edición sin llamadas de IA, HTML/PNG/ZIP, seis copies, ocho composiciones, cuatro formatos e historial recuperado en otra instancia.
- `node scripts/check-documents.mjs`: conservación íntegra del texto, DOCX nativo, dos fuentes, PDF de varias páginas, membrete repetido, edición sin IA, Sol opcional y recuperación desde otra instancia.
- `node scripts/check-cms-csrf.mjs`: uso del token vigente cuando cambia en otra pestaña, con alternativa para una cookie ausente o mal formada.
- `node scripts/check-presentation-images.mjs`: proporciones en marcos verticales, horizontales y cuadrados; reparación repetible de archivos anteriores sin modificar el medio original.

Estas pruebas usan un servidor simulado y no consumen créditos. La validación visual incluye render de DOCX con LibreOffice y comprobación del PDF. La última revisión funcional se realiza en el CMS publicado con una generación real, separada de las pruebas simuladas.
