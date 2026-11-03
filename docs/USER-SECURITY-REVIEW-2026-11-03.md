# Seguridad de acceso y sesiones del CMS — 2026-11-03

La revisión se hizo sobre el código local y un backend temporal con cuentas ficticias. No se probaron intentos contra producción, no se cambiaron contraseñas reales ni se revocaron sesiones del cliente. La publicación y la comprobación no invasiva del entorno remoto corresponden a la integración de esta entrega.

## Protecciones que ya existían

- Better Auth 1.7.14, contraseñas verificadas por el proveedor, sesión con `expiresIn` de ocho horas y `updateAge` de una hora. El CMS también comprobaba ocho horas desde `createdAt`.
- Cookies de sesión `Secure` en HTTPS, `HttpOnly` y `SameSite=Lax`; orígenes confiables, CSRF, respuestas privadas sin caché y registros de runtime saneados.
- Registro inicial cerrado después de crear la cuenta principal. Roles y permisos se comprueban en el servidor; las operaciones de usuarios/configuración requieren propietario y las mutaciones de contenido requieren propietario/editor.
- El archivo local `auth-security.mjs` declaraba cinco fallos por cuenta y 25 por IP en una ventana de 15 minutos, con bloqueo temporal de 15 minutos. Los valores de identificación se resumían con SHA-256.
- Better Auth agrega sus propios límites en producción: 100 solicitudes en diez segundos como regla general y tres solicitudes de acceso en diez segundos. Su almacenamiento predeterminado es memoria y las llamadas internas `auth.api` no pasan por ese límite. Se verificó tanto en la dependencia instalada como en su [documentación oficial](https://better-auth.com/docs/concepts/rate-limit).

Se encontraron tres problemas concretos en la implementación local: el wrapper de acceso consultaba `req.body` antes del parser y podía perder la identidad de cuenta; la limpieza de contadores podía descartar un bloqueo vigente cuando vencía la primera ventana; y las comprobaciones separadas antes/después de autenticar no reservaban los intentos simultáneos. El cambio de contraseña tampoco revocaba las demás sesiones. El tope de ocho horas devolvía una respuesta sin sesión, pero no eliminaba por sí mismo la fila correspondiente.

## Política y cambios implementados

| Control | Comportamiento |
|---|---|
| Fallos por cuenta | Cinco dentro de 15 minutos; cuenta normalizada y clave HMAC |
| Fallos por IP verificada | 25 dentro de 15 minutos, únicamente con un resolver de cliente explícito y confiable; no está configurado en esta entrega |
| Transporte sin proxy verificado | 100 fallos en 60 segundos, máximo diez comprobaciones concurrentes y espera corta de diez segundos; no impone un bloqueo de 15 minutos a visitantes que comparten proxy |
| Bloqueo de cuenta | 15 minutos desde el fallo que alcanza el umbral; los rechazos no lo prolongan |
| Concurrencia | Reservas transaccionales para no admitir más intentos simultáneos que el presupuesto disponible |
| Reservas interrumpidas | Caducan en 90 segundos; un reinicio no crea un bloqueo permanente |
| Éxito | Reinicia los fallos de esa cuenta; conserva el presupuesto de red |
| Inactividad | 30 minutos desde la última actividad confirmada |
| Aviso | Dos minutos antes; botón para continuar trabajando |
| Duración absoluta | Ocho horas desde la creación original, aunque exista actividad |
| Cambio de contraseña | Conserva la sesión actual y revoca las otras del usuario |
| Restablecimiento administrativo | Revoca todas las sesiones del usuario objetivo |

El módulo nuevo usa tablas propias en el mismo SQLite de autenticación. Las decisiones de contador/reserva se ejecutan en transacciones inmediatas. Los rótulos de cuenta, conexión y sesión usan HMAC con el secreto que ya utiliza el servidor; no se guarda otra copia de la contraseña, correo, IP o token en estas tablas. Los eventos nuevos solo contienen resultados, umbrales y motivos genéricos, sin identificadores personales. Las respuestas de credenciales no permiten distinguir entre cuenta inexistente, contraseña incorrecta o acceso no disponible para esa identidad. Los bloqueos incluyen `Retry-After`.

El wrapper lee una copia del `Request` antes de delegar en Better Auth, conserva el cuerpo original y aplica un límite acotado de 16 KB y diez segundos de lectura para este formulario. Las demás rutas del proveedor conservan su autenticación. También se valida que la sesión exista realmente en SQLite; se desactiva la caché de cookie al consultarla desde la guardia y se evita que una lectura refresque su vencimiento. El vencimiento absoluto queda acotado por la fecha persistida y por cualquier fecha upstream más corta: no puede deslizarse si faltan fechas del proveedor. Caducar por inactividad o por el máximo absoluto elimina la sesión real, además de rechazar el acceso al CMS.

No se activan bloqueos permanentes ni excepciones que permitan al propietario saltarse las mismas reglas. Una sesión ya válida no se revoca por los fallos posteriores de acceso a su cuenta. Las sesiones existentes reciben una primera ventana de 30 minutos al inicializar el control de inactividad; su límite absoluto original se conserva.

El cambio de contraseña conserva `revokeOtherSessions:false` en la llamada interna y después elimina las otras sesiones, manteniendo el ID actual. Es deliberado: en esta versión de Better Auth, usar `true` elimina todas y genera una nueva cookie, que la ruta custom no reenviaba. Se verificó que el usuario permanezca autenticado y que la cookie anterior de otra sesión deje de servir. No se rotaron claves ni se cambiaron credenciales existentes.

## Actividad y experiencia de edición

`GET /api/cms/auth/activity` consulta los vencimientos y no renueva la inactividad. `POST` requiere sesión y CSRF, y registra actividad con la hora del servidor. `auth-state` incorpora `userSecurity` con `serverNow`, `lastActivityAt`, `idleExpiresAt`, `absoluteExpiresAt`, política y cadencia; no expone ID ni token de sesión.

El cliente escucha teclado, pulsación, tacto, entrada/cambio de texto, clic y desplazamiento asociado a una intención real del usuario; agrupa las actualizaciones en intervalos de 60 segundos. Incluye entradas de voz, IME y tecnologías de asistencia que pueden no generar una tecla. No toma una generación, un polling, un temporizador ni un `scrollIntoView` automático como actividad humana. Las consultas periódicas permiten detectar actividad de otra pestaña sin renovar la sesión por sí mismas. La protección autoritativa sigue siendo el reloj y el estado del servidor: los eventos del navegador son una ayuda de uso, no una prueba criptográfica de presencia humana.

El aviso no roba el foco mientras se escribe. Al caducar se borran campos de contraseña, se solicita acceso y se conserva el estado de edición en memoria en esa pestaña. El módulo devuelve una señal de reanudación solo si vuelve la misma cuenta; la aplicación debe mostrar el apartado existente sin volver a navegar/cargarlo. No guarda textos jurídicos, contraseñas ni identificadores en `localStorage` o `sessionStorage`. Recargar/cerrar la pestaña antes de recuperar el trabajo no ofrece esa garantía. Es necesario cargar la nueva versión del CMS para disponer del aviso y de la señal de actividad.

Las respuestas de consultas de una sesión anterior se descartan mediante una generación de cliente para impedir que un 401 tardío cierre una sesión recién recuperada. La interfaz principal debe usar la misma comprobación antes de su cambio de pantalla por 401. Volver mediante la caché de navegación del navegador recupera el seguimiento y consulta al servidor; no registra por sí solo actividad ni reinicia los vencimientos.

## Alcance y recomendaciones adicionales

Las transacciones son atómicas dentro de ese archivo SQLite. **No se afirma un límite global compartido entre réplicas** ni persistencia mayor que la que tenga la base del entorno. Una instalación con varias réplicas requiere un almacén compartido antes de atribuirle esa garantía. No se añadió Redis ni un servicio externo.

La fábrica acepta el callback opcional `onMutation`, sin datos de usuario como argumentos. La integración remota debe conectarlo a `() => persistAuthDatabase()` para conservar su mecanismo previo de snapshot durable. Se notifica tras reservar/finalizar/liberar intentos, crear metadatos de sesión, registrar actividad y revocar sesiones; también después de que termina el handler de Better Auth, porque la sesión de un acceso exitoso se crea después de la reserva y el cierre de sesión ocurre en el proveedor. Las notificaciones del mismo turno se agrupan; las persistencias se serializan y un cambio durante una persistencia pendiente solicita otra al terminar. No bloquea la respuesta de acceso y los errores pasan por el logger saneado. Las consultas de actividad sin cambio no solicitan otro snapshot. El callback local predeterminado no hace nada: esta conexión remota debe preservarse de forma explícita al publicar, sin copiar funciones remotas al módulo local.

Sin una política de proxy verificada, la dirección del socket identifica transporte compartido y recibe solo el presupuesto rápido de 100/60 segundos y diez concurrentes. No se usa para aplicar el bloqueo de cuenta de 15 minutos. El presupuesto de 25 fallos por IP solo se habilita al proporcionar desde código del servidor un resolver de cliente explícito y verificado; no se activa leyendo una cabecera arbitraria del solicitante. Hasta verificar los saltos y cabeceras confiables de Replit no se afirma granularidad por visitante. El límite por cuenta es independiente. No se vincula una sesión a una IP fija para evitar cierres al cambiar de red.

No se purgó historial ni se eliminaron los archivos legacy de contadores. Las nuevas tablas comienzan sus propios contadores. El wrapper remoto de autenticación debe compararse antes de cambiar su ruta: cualquier control adicional remoto debe conservarse; no se debe sobrescribir completo `server/index.mjs`, `.replit`, la base ni Secrets.

Como siguiente mejora, conviene ofrecer **2FA o passkeys** a propietarios, con alta, recuperación y códigos de respaldo probados por el propio usuario. No se activó un segundo factor sin ese enrolamiento. La longitud mínima configurada sigue siendo ocho caracteres: conviene revisar una política de frases de contraseña más largas, gestores y recuperación antes de cambiar requisitos a cuentas existentes. También siguen siendo importantes las copias recuperables de la base, la revisión periódica de accesos y las actualizaciones de dependencias; esta revisión no equivale a una auditoría de penetración completa.

La separación entre inactividad y duración absoluta y su aplicación en servidor sigue la [guía de sesiones de OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html). Los rechazos genéricos y el bloqueo temporal se apoyan en su [guía de autenticación](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html). La [documentación de sesiones de Better Auth](https://better-auth.com/docs/concepts/session-management) respalda los controles de refresco, caché y revocación; los valores 30 minutos/dos minutos/ocho horas son la decisión de este CMS.

## Verificación

`check-user-security.mjs` usa SQLite temporal, reloj controlado y backend real aislado. Comprueba: bloqueo que sobrevive al fin de la ventana original, cinco reservas concurrentes por cuenta, 25 fallos en una señal IP marcada como verificada por la fixture, presupuesto compartido 100/60 segundos y diez concurrentes, rótulos HMAC y persistencia en la misma base; lectura sin renovación, actividad/CSRF, caducidad y borrado de sesión; límite absoluto inmutable incluso sin fechas upstream; login de cuerpo original, respuestas genéricas y quinta falla; revocación al cambiar contraseña sin perder la sesión actual; cierre de sesión y consistencia propietario/editor. Los logs no contienen las credenciales ni identidades de las cuentas ficticias.

Una fixture adicional comprueba el callback sin argumentos, su agrupación/serialización y que una persistencia pendiente no bloquee el acceso. Verifica que un snapshot posterior incluya la sesión creada por el proveedor, que el cierre de sesión también lo solicite y que una lectura de metadatos ya existentes no genere escrituras adicionales.

También pasaron las comprobaciones existentes de autenticación, seguridad de runtime y CSRF. Las pruebas no hicieron solicitudes de autenticación fallida a producción ni modificaron datos reales. Las anclas exactas de integración se encuentran en `data/local-build-work/user-security-20261103/index-anchors.json`; los cambios de la interfaz principal los integra el agente raíz.
