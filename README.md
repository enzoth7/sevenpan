# sevenpan

Aplicación B2B para la panadería matriz y sus panaderías clientes. El catálogo usa precios globales para nuevas comandas; cada ítem guarda el precio aplicado para conservar el historial.

## Desarrollo

1. Copiá `.env.example` a `.env.local` y completá la clave publicable del proyecto.
2. Ejecutá `npm install` y `npm run dev`.
3. Las migraciones versionadas están en `supabase/migrations/` y las funciones en `supabase/functions/`.

## Rutas de la aplicación

- Panaderías: `/inicio`, `/hacer-pedido`, `/pedidos`, `/estadisticas`, `/mi-panaderia`.
- Administración: `/admin`, `/admin/pedidos`, `/admin/clientes`, `/admin/clientes/:codigo`, `/admin/productos`.
- El historial del navegador mantiene la navegación entre pantallas y permite abrir directamente una ruta luego de iniciar sesión.

## Reporte diario de producción

En **Administración > Pedidos**, el bloque **Pedidos para mañana** descarga un PDF A4 con:

- una primera página que consolida las cantidades de todas las comandas activas por producto;
- una segunda página que agrupa los productos por panadería cliente;
- marca Seven Pan, fecha de entrega y paginado.

La fecha de entrega se asigna automáticamente en `America/Montevideo`: los pedidos confirmados hasta las 18:00 inclusive se entregan al día siguiente; los confirmados después de las 18:00 se entregan al subsiguiente. Por ejemplo, el PDF del 17/8 toma pedidos ingresados después de las 18:00 del 15/8 y hasta las 18:00 del 16/8.

El reporte también arrastra los pedidos que continúan pendientes con una fecha anterior. Excluye pedidos cancelados, entregados y pedidos programados para fechas posteriores.

Para generar el PDF de muestra usado en la verificación visual:

```bash
npm run report:sample
```

## Endpoints autenticados

- `POST /functions/v1/orders`: crear una comanda.
- `PATCH /functions/v1/orders/:id`: editar una comanda pendiente.
- `DELETE /functions/v1/orders/:id`: cancelar una comanda pendiente.
- `GET /functions/v1/me`: consultar la panadería asociada.
- `PATCH /functions/v1/me`: actualizar dirección, localidad, teléfono e indicaciones de entrega.
- `POST /functions/v1/admin/customers`: crear un negocio y su acceso principal pendiente.
- `PATCH /functions/v1/admin/customers/:id/access`: corregir o reemplazar el responsable autorizado.
- `POST /functions/v1/admin/customers/:id/access-code`: generar un nuevo código de activación o recuperación.
- `PATCH /functions/v1/admin/customers/:id/status`: pausar o reactivar un negocio.
- `POST /functions/v1/access/activation/complete`: activar una cuenta con los códigos entregados por Seven Pan.
- `POST /functions/v1/access/recovery/complete`: establecer una contraseña nueva con un código de recuperación.
- `POST /functions/v1/admin/products`: crear un producto.
- `PATCH /functions/v1/admin/products/:id`: actualizar precio o disponibilidad.
- `PATCH /functions/v1/admin/orders/:id/status`: actualizar el estado de un pedido.

Nunca agregues `SUPABASE_SERVICE_ROLE_KEY` ni otra clave secreta a variables `VITE_*`: la clave de servicio se utiliza exclusivamente dentro de las Edge Functions.

## Primer administrador

No existe registro público. Creá la primera cuenta con correo y contraseña desde **Authentication > Users** en Supabase y, con su UUID, ejecutá en el SQL Editor:

```sql
select private.bootstrap_admin('UUID_DEL_USUARIO', 'Nombre de administración');
```

Luego esa cuenta podrá ingresar al panel y crear panaderías clientes. Cada alta genera un código permanente `SP-XXXXXX`, un código temporal de activación y un usuario pendiente sin contraseña.

## Activación sin correo transaccional

No se necesita Resend, SMTP ni un dominio propio. El administrador comparte por WhatsApp, teléfono o personalmente el código temporal de activación, por ejemplo `7K4M-P9Q2-XR6T`. El código permanente del negocio queda como identificador visible en su ficha, pero no se usa para activar el acceso.

El código temporal tiene 12 caracteres, vence a las 48 horas, se guarda únicamente como hash y sólo puede utilizarse una vez. Cada código nuevo invalida el anterior. La función pública limita los intentos por negocio, correo e IP.

Para recuperar una contraseña, el administrador abre la ficha del cliente y genera un código temporal de recuperación. El cliente completa ese código y una contraseña nueva.

En **Authentication > Sign In / Providers**, mantené desactivado **Allow new users to sign up** y la contraseña mínima en 8 caracteres. El correo funciona como identificador de ingreso; la autorización inicial se comprueba mediante el código que Seven Pan entrega al responsable. El celular se guarda normalizado para una futura integración con Twilio, pero todavía no se ofrece como método de ingreso.

## Producción

- Definí el secreto de Edge Functions `APP_URL` con la URL exacta del frontend para limitar CORS.
- Configurá esa misma URL en **Authentication > URL Configuration**.
- Aplicá las migraciones en orden y desplegá `orders`, `me` y `admin` con JWT obligatorio.
- Desplegá `access` sin verificación JWT en el gateway; la función valida el código de un solo uso, su vencimiento y los límites de intentos antes de cambiar la contraseña mediante el cliente de servicio.
- Las comandas se crean, editan o cancelan hasta las 18:00 de `America/Montevideo`; la validación está en la base, no solo en la interfaz.
