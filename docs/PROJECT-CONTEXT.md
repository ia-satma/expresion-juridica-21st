# Contexto canónico del proyecto Expresión Jurídica

Actualizado el 2026-11-10. Este documento reúne las decisiones vigentes del sitio, CMS y estudio editorial para que una nueva sesión pueda retomar el trabajo sin reconstruir el contexto desde el historial de chat.

## Identidad y despliegue

- Despliegue del cliente: https://expresion-juridica-mx.replit.app/
- CMS del cliente: https://expresion-juridica-mx.replit.app/admin/
- Repositorio: https://github.com/ia-satma/expresion-juridica-21st.git, rama `main`.
- Workspace local: `/Volumes/alejandro /JHH WEB PAGES`.
- Replit del cliente: `https://replit.com/t/expresion-juridica/repls/expresion-juridica-21st-2`. La instancia histórica es `https://expresion-juridica-21-st.replit.app/`.
- El procedimiento de aprovisionamiento y recuperación está en [REPLIT-TRANSFER.md](REPLIT-TRANSFER.md). El código de persistencia y manejo de límites de IA quedó en `1715f53`.
- El despliegue público usa `63df2ab`. Después de republicar se verificaron el propietario y la sesión existentes, las miniaturas de presentaciones y el acceso público a los recursos de firma. El secreto temporal de recuperación se retiró.
- El acceso multidominio quedó en `9b0f52d`. Better Auth y el middleware comparten `server/auth-hosts.mjs`, aceptan los tres dominios conectados y permiten patrones controlados como `*.cliente.example` mediante `CMS_AUTH_ALLOWED_HOSTS`. Un host desconocido sigue rechazado.
- El sistema de OpenAI serializa las llamadas de texto e imagen, respeta `Retry-After` hasta 30 segundos y conserva el tiempo de espera en los jobs. El commit `024d6db` incorpora esta protección.
- Los archivos originales proporcionados por el cliente (`1.jpeg`, `2.jpeg`, `Hoja membretada.pdf` y `documentos /`) permanecen fuera de los commits de código.

## Marca y contacto

La identidad vigente es EJ-MANUAL y la tarjeta aprobada por el cliente. Usa azul institucional `#141A3A`, azul noche `#0B0F1E`, dorado `#D9BC88`, gris `#DADADA` y papel `#F4F4F4`. La tipografía editorial usa Libre Caslon Text Italic y Bahnschrift Light. El CMS utiliza Montserrat para su interfaz.

El correo canónico del sistema es `Consultoria@expresionjuridica.com`. El membrete actual es el PDF final entregado por el cliente, conservado como PDF vectorial y como PNG de 180 dpi para DOCX. El pipeline valida tamaño Letter y no vuelve a insertar el correo ni el domicilio.

## Arquitectura

El sitio público existente vive en `sitio/`. Express lo sirve y aplica overrides del CMS. El panel está en `public/admin/`. En el despliegue del cliente, Better Auth y los controles de acceso usan PostgreSQL con `CMS_AUTH_STORAGE=postgres`. El workspace de desarrollo conserva SQLite. App Storage conserva el contenido y la configuración del CMS, medios, exportaciones y estado de los estudios por scope.

Módulos principales:

- `server/index.mjs` contiene rutas, permisos, usuarios, contactos, presentaciones y configuración.
- `server/presentation-generator.mjs` crea escenas compartidas para PPTX, PDF y PNG.
- `server/social-generator.mjs` y `server/social-compositor.mjs` crean posts/carruseles HTML y PNG.
- `server/document-generator.mjs` crea DOCX/PDF editables con membrete.
- `server/user-security.mjs` aplica límites de acceso, inactividad y duración absoluta.
- `server/studio-state.mjs` y `server/studio-jobs.mjs` conservan trabajos e historial.

## Agentes y modelos

- Texto y dirección editorial: `gpt-6.1-sol`.
- Las llamadas de texto solicitan `service_tier: "fast"`, conservando el modelo y el esfuerzo de razonamiento. Se registra el nivel solicitado y el servido cuando el proveedor lo informa.
- Los estudios muestran por separado los límites temporales, la cuota y las credenciales rechazadas. Las respuestas temporales reconocidas admiten un reintento acotado con el mismo modelo y nivel cuando la espera cabe en el presupuesto de la operación.
- Imágenes: `gpt-image-2.5-sunburst` en la configuración comprobada. Las fotos son documentales, realistas y mexicanas por defecto, salvo geografía explícita.
- `OPENAI_API_KEY` solo existe en Secrets del servidor. Nunca se envía al navegador.
- Las fotos generadas se conservan como metadata interna. La leyenda visible «Imagen generada con IA» fue retirada de presentaciones y posts.

## Presentaciones

Cada presentación puede incluir las dos láminas institucionales entregadas por el cliente:

- `server/assets/ej-brand/presentation-opening.jpeg` abre la presentación.
- `server/assets/ej-brand/presentation-closing.jpeg` la cierra.
- El interruptor `Incluir diapositiva de entrada y cierre` está activado por defecto y permite generar solo el contenido.
- El número elegido representa diapositivas de contenido. Con el interruptor activo se agregan dos páginas.
- PPTX conserva textos, formas, diagramas, fotografías y logotipo como objetos editables. PDF y PNG incluyen las páginas completas.
- La prueba `scripts/check-presentations.mjs` verifica ambos modos, fuentes incrustadas, proporciones de imagen y ausencia de pies de IA visibles.

## Posts y carruseles

El compositor usa HTML editable y PNG derivados de la misma escena. Permite posts individuales y carruseles de hasta 20 piezas, paletas EJ coordinadas, fondos sólidos, degradados tonales, halo dorado, composiciones variadas y nueve formatos con recomendación de red social. El copy se genera para seis redes. Las piezas se descargan individualmente o en ZIP. El texto manual del cliente se conserva durante las revisiones.

## Documentos con membrete

El editor Tiptap permite títulos, subtítulos, texto, listas, citas, negritas, cursivas y subrayado. Guardar no llama a IA. El texto se conserva íntegro y se justifica en el documento exportado. DOCX usa párrafos y estilos nativos, repite el membrete en todas las páginas, incrusta fuentes y mantiene el contenido editable. PDF conserva texto seleccionable. El pipeline comprueba documentos largos, correo único, ausencia de correo antiguo, fuentes y recuperación desde otra instancia.

## CMS y usuarios

El panel edita contenido por sección y guarda el cambio con confirmación Antes/Después. No existe un paso separado de publicar cambios para estas ediciones.

Usuarios y accesos ahora muestran una tabla con correo/usuario, rol, estado, último acceso y acciones. Incluye cambio de rol, switch de acceso, restablecimiento de contraseña temporal y panel de permisos. El historial de accesos recientes, con resultado y origen protegido, sólo se muestra al rol Administrador (`owner`) y el endpoint está protegido con `requireOwner`. La contraseña mínima sigue siendo de 8 caracteres.

La tabla conserva filas nativas de HTML (`display: table-row`); una regla antigua de `.user-row` que la convertía en flex provocaba que las celdas se apilaran. El ajuste quedó en `6453961` y fue republicado en Replit. Después se refinó la composición con iconos SVG accesibles, acciones sin wrap, proporciones de columna ajustadas, hover de fila y tamaño compacto para que las tres acciones permanezcan en una sola línea (`9165a7f`, `2fbebc5`).

El archivado de usuarios es recuperable. Archivar revoca sesiones y oculta la cuenta de la lista normal. `Mostrar archivados` permite restaurarla. No se borra permanentemente una cuenta desde este flujo. El propietario actual no puede archivarse y el sistema protege la existencia de un propietario activo.

## Seguridad

Controles verificados en local y Replit:

- Cinco fallos por cuenta en 15 minutos.
- Límite de transporte de 100 fallos por 60 segundos y diez reservas concurrentes.
- Inactividad real de 30 minutos con aviso de 2 minutos.
- Duración absoluta de sesión de 8 horas.
- CSRF, cookies Secure/HttpOnly/SameSite, CSP, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy y COOP.
- Logs privados sin contraseñas, API keys, nombres, correos, payloads o tokens.
- `npm audit` completo con 0 vulnerabilidades.
- Tiptap actualizado a 3.33.0 y Better Auth a 1.7.18. Solo quedan actualizaciones mayores de `better-sqlite3` 13 y `opentype.js` 2 pendientes de compatibilidad.
- El cookie `GAESA` pertenece a Google Frontend/Replit y queda fuera del control de la aplicación.

## Pruebas recientes

- `node scripts/check-auth-security.mjs`
- `node scripts/check-user-security.mjs`
- `node scripts/check-security.mjs`
- `node scripts/check-secret-exposure.mjs`
- `node scripts/check-openai-service-tier.mjs`
- `node scripts/check-presentations.mjs`
- `node scripts/check-documents.mjs`
- Sintaxis de `server/index.mjs` y `public/admin/app.js`.

Todos pasan en el corte actual. Los commits de esta etapa son `e5de34c` (membrete y pies IA), `dd19ce1` (apertura y cierre), `a041899` (interruptor), `93c3b66` (metadata), `86071d2` (seguridad y dependencias), `13b4107` (bundle Tiptap), `3dc7423` (panel de usuarios), `ac143d7` (restauración de propietarios archivados), `6453961` (fila nativa de la tabla de usuarios), `9165a7f` y `2fbebc5` (refinamiento visual de usuarios), `6136fe4` (contexto canónico) y `38da2aa` (documentación operativa).

## Continuidad

Antes de sincronizar cambios completos desde GitHub a Replit, conservar el `server/index.mjs` remoto si contiene personalizaciones de autenticación y persistencia. Aplicar parches de ancla exacta y ejecutar las regresiones. No incluir Secrets, bases SQLite, JSON de producción, TTF/EOT privados ni los archivos de referencia del cliente en commits de código.

El procedimiento de cambio de cuenta está en [`docs/REPLIT-TRANSFER.md`](./REPLIT-TRANSFER.md). El preflight reproducible es `node scripts/check-replit-transfer.mjs`; cubre Node, Cloud Run, scope de datos, Secrets, App Storage y exclusión de datos de producción.

### Prueba real de generación con fotografías (2026-11-10)

- La presentación real sin imágenes completó el flujo de Sol, composición, guardado y exportación. Se generaron 5 diapositivas (3 de contenido + apertura y cierre institucionales) y el PPTX descargó correctamente con 4.3 MB; el PDF renderizó 5 páginas y conservó texto, logotipo y correo.
- Una prueba separada con `Ilustrar con imágenes generadas por IA` activado llegó al paso `Imágenes` y recibió `OPENAI_RATE_LIMIT_EXCEEDED`. Esto confirma un límite temporal del endpoint de imágenes de OpenAI, separado del saldo monetario y de la llamada de texto.
- `server/openai-service-tier.mjs` ahora conserva la cola global y, para `/images/generations`, respeta `Retry-After` hasta 120 segundos y aplica una espera inicial más prudente si el proveedor no envía cabecera. La cuota no se presenta como disponible cuando el proveedor responde un límite.
- El cambio quedó en `e0bd62b`, pasó `node scripts/check-openai-service-tier.mjs` y fue republicado en Replit; Publishing muestra `Live` con historial `88e44aaa`.
