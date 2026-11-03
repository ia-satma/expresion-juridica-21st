# Editor del CMS y copia del formulario — 2026-11-03

Estado: publicado y verificado en producción el 2026-11-03. Interfaz `20261103-editable3`.

## Flujo aprobado por Alejandro

1. Elegir Inicio o una página y después una sección reconocible.
2. Editar textos visibles, enlaces o medios. El cliente no edita el HTML de la plantilla.
3. Pulsar **Guardar cambios** y revisar el antes y el después.
4. Pulsar **Aceptar y guardar**. La misma operación guarda los cambios aprobados y los hace visibles en el sitio.

Se retiraron de la interfaz los botones «Publicar cambios». La separación anterior entre borrador y publicación se conserva solo como compatibilidad interna: no forma parte del flujo nuevo. Los cambios pendientes de la versión anterior se recuperan para revisión, sin aprobarlos de forma automática.

## Correcciones del editor

- Inicio y Páginas usan un controlador común con formularios identificados por su contexto. Se elimina el guardado que tomaba la primera copia de un campo, aunque estuviera en una vista oculta.
- Se mantienen las ediciones al cambiar de sección o página y no se recarga todo el formulario después de guardar un campo.
- Catálogo de texto legible con secciones, búsqueda y opciones separadas para textos, medios, buscadores y accesibilidad. Las rutas CSS, plantillas, campos anidados redundantes y etiquetas HTML dejan de ser la interfaz del cliente.
- La edición aplica el texto a la plantilla confiable, conserva énfasis, spans de animación y copia accesible. Las variantes de escritorio y móvil se agrupan y actualizan juntas. Menú y pie compartidos se actualizan en las páginas correspondientes.
- Validación completa antes de aplicar un lote; guardados de contenido ordenados por proceso; restauración de los valores afectados y su auditoría si falla la persistencia. No se publican otros borradores ajenos al lote aprobado.
- Se espera la confirmación del almacenamiento antes de responder que el contenido quedó guardado. La cola de App Storage usa snapshots privados separados y propaga errores a los guardados que la esperan; conserva la restauración existente al arrancar.
- Bindings y valores renderizados permiten recuperar los cambios tras la hidratación del sitio y aplicar varios atributos del mismo elemento.
- En móvil se corrigió la columna fija que desplazaba el contenido fuera de pantalla. Página y sección se eligen mediante controles nativos; el diálogo y el guardado caben a 390 px. La opción de cerrar sesión permanece disponible.
- Páginas usa dos selectores claros (página y sección) también en escritorio, con una sola columna amplia de edición. Se muestran 17 páginas canónicas; el alias de Civil no aparece duplicado. El título principal se presenta primero.

## Formulario y Solicitudes

El formulario se conecta desde el inicio y después de la hidratación. Primero valida y guarda la solicitud; después prepara el correo para **Consultoria@expresionjuridica.com**. Si la aplicación de correo no se abre automáticamente, queda disponible el enlace **Abrir correo**.

El nombre, correo, materia y mensaje completo se guardan en el CMS. Se mantiene el límite existente de 600 caracteres del formulario, sin truncar silenciosamente un mensaje aceptado. Los reintentos de un mismo envío conservan una sola copia.

Los registros nuevos y sus cambios de estado usan almacenamiento privado por entorno, con App Storage cuando está configurado y archivos locales en el entorno aislado. El JSON histórico del CMS sigue siendo un respaldo de registros anteriores. Se confirma la persistencia antes del recibo; si falla, se conserva el contenido del formulario y no se inicia el correo.

Esto prepara un mensaje en la aplicación de correo del visitante. No se añadió un servicio de envío automático de correo desde el servidor.

## Permisos y seguridad conservados

La matriz de permisos se comprueba en el servidor y se refleja en la navegación. El propietario conserva acceso completo; el editor recibe por defecto contenido, medios, firmas y solicitudes; el visualizador tiene lectura editorial y no accede a solicitudes ni auditoría privada. Los permisos personalizados se respetan. Las mutaciones mantienen los controles de rol, sesión, origen y CSRF.

Siguen activos CSP, cookies protegidas, no-store privado y los logs por lista permitida de la [revisión de seguridad](SECURITY-REVIEW-2026-11-03.md). Los tests no exponen credenciales, nombres, mensajes ni valores de cookies reales. No se modificaron modelos de IA, tipografías de los exportadores ni el contenido del cliente para probar el guardado.

## Evidencia y alcance

| Comprobación | Resultado |
|---|---|
| Catálogo estático | 18 fuentes HTML; 1,910 nodos de texto visibles cubiertos, sin campos que expongan markup de la plantilla |
| Navegación editorial | 17 páginas canónicas; alias de Civil excluido; selector de página/sección y título principal al inicio |
| Encabezados con estilo | Texto visible/accesible, énfasis y wrappers conservados |
| Guardado | Lote validado, confirmación obligatoria, resultado público inmediato y borradores no aprobados conservados |
| Copias responsive | Edición agrupada y restauración exacta de la fuente |
| Fallos de almacenamiento | Se verifican rechazos asíncronos, sin recibo de éxito ni pérdida de las ediciones |
| Autenticación real temporal | 10 rutas privadas requieren sesión; CSRF obligatorio; guardado de contenido visible sin llamada de publicación |
| Formulario | Copia completa en Solicitudes y en archivo privado por entorno; reintento sin duplicado; enlace de correo correcto |
| Navegador local | Inicio/Páginas conservan el texto editado en la copia visible; confirmación cancelable; envío ficticio con una copia en Solicitudes y sin errores CSP/React observados |
| Móvil local | 390 px de viewport y 390 px de documento; diálogo de 370 px; cero botones de publicación visibles |
| Regresión | CSP, consola privada, cookies, CSRF entre pestañas, 17 canónicas/18 fuentes, 24 bindings de ajustes, compresión y rangos de video correctos |
| Replit / Node 20 | Suites de contenido, autenticación, seguridad y optimización correctas; política adicional de contraseña inicial conservada |
| CMS en producción | Inicio/Páginas con texto legible; cero botones de publicación visibles; diálogo real Antes/Después con Aceptar y guardar; cancelación verificada sin publicar el ejemplo |
| Móvil en producción | Viewport/documento de 390/390 px; sin HTML en los campos visibles; cierre de sesión disponible; tamaño de prueba restaurado |
| Formulario en producción | Respuesta 201, copia completa visible en Solicitudes y estado Archivada conservado tras recargar; solo registro ficticio marcado como prueba técnica, sin enviar correo |
| Seguridad en producción | 3 páginas públicas responden 200; 10 rutas privadas responden 401 sin sesión; CSP, no-store privado e identidad anónima oculta correctos |
| Reproducción en producción | Película de 97 s avanzó más de 10 s con readyState 4, sin error de video; cero errores/advertencias observados en el sitio y el CMS |

Comandos principales: `node scripts/check-cms-content.mjs`, `node scripts/check-auth-security.mjs`, `node scripts/check-security.mjs`, `node scripts/check-site-optimization.mjs` y `node scripts/check-cms-csrf.mjs`.

Las cuentas y mensajes usados en las pruebas son ficticios. La autenticación real de prueba usa SQLite y directorio temporales sin heredar Secrets. En ese entorno se guardó un título desde la interfaz, se comprobó su cambio público después de arrancar JavaScript y abrir el menú, sin errores React/CSP. La verificación del sitio real conserva las ediciones anteriores del propietario y no confirma ni publica textos de prueba. La solicitud técnica quedó archivada, no eliminada. La cobertura de texto se refiere al HTML inventariado, no a letras incorporadas en fotografías o logotipos; las fuentes no contienen nodos SVG de texto.

Se preservaron las personalizaciones remotas del CMS con comparación SHA-256 y 18 parches exactos, más el bloque de almacenamiento revisado; la revisión final aplicó otros 3 parches acotados. No se reemplazó completo el servidor ni se sobrescribió `.replit`. Se mantiene la separación entre código, datos privados y Secrets. Las tres fuentes públicas del CMS se reconciliaron con la versión remota; aún queda deuda de reconciliar las funciones adicionales de autenticación del servidor remoto y la configuración local de despliegue.

Evidencias saneadas: `production-browser.json`, `production-headers.json` y `production-regression.json` en `data/local-build-work/cms-editor-20261103/` (ignoradas por Git). No contienen credenciales, cookies, identidades ni mensajes reales. Las capturas de la interfaz y la confirmación se incluyen en el registro de Obsidian.
