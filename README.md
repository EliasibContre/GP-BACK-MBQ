# Gestión de Provedores
Este repositorio alberga el código fuente de Gestión de Provedores, una aplicación que separa el backend y el frontend en proyectos independientes. A continuación encontrarás información útil para entender la estructura de ramas, levantar cada servicio y conectar la base de datos y el almacenamiento utilizando Supabase.

## Estructura de ramas
| Rama          | Descripción                                                         |
| ------------- | ------------------------------------------------------------------- |
| **main**      | Rama estable con las versiones listas para producción.              |
| **dev**       | Rama de desarrollo activo donde se integran nuevas funcionalidades. |


## Cómo levantar el backend
El código del backend se encuentra en el directorio GP-Backend. Está construido con Node.js y usa Prisma para la capa de acceso a datos. Sigue estos pasos para ponerlo en marcha:

#### 1. Instala las dependencias
```bash
cd GP-Backend
npm install
```

#### 2. Configura las variables de entorno
Crea un archivo `.env` en `GP-Backend` con las variables necesarias (por ejemplo, las credenciales de la base de datos de Supabase que se muestran más adelante).

#### 3. Genera e inicializa la base de datos (solo la primera vez) 
Prisma ofrece scripts para generar el cliente y aplicar migraciones.
```bash
# Genera el cliente de Prisma
npm run prisma:generate

# Aplica migraciones en modo de desarrollo
npm run prisma:migrate

# (Opcional) inserta datos de prueba
npm run seed
```
#### 4. Ejecuta el servidor en modo de desarrollo
```bash
npm run dev
```
Esto lanzará el servidor con `nodemon` y recargará automáticamente cuando cambie el código. Para ejecutarlo en modo producción utiliza:
```bash
npm start
```

## Conectar la base de datos y el almacenamiento en Supabase
El proyecto usa [Supabase](https://supabase.com/) para la base de datos (PostgreSQL gestionado) y para el almacenamiento de archivos. A continuación se resume el procedimiento descrito en el archivo “**Conectar BD, Bucket en supabase.md**” junto con sus imágenes, para que puedas reproducir los pasos fácilmente.

### 1. Obtener la conexión de la base de datos
**1.** Ingresa a tu proyecto de Supabase y selecciona el apartado “**Connect**” dentro de la sección “Database”. Allí encontrarás información sobre cómo conectarte a la base de datos.
<br />
<br />
<img width="650" alt="image" src="https://github.com/user-attachments/assets/f40246fa-027f-43f6-a355-e5af6aa43ed1" />
<br />
<br />
**2.** Si deseas conectarte mediante URI, copia la URL que aparece en la sección “Connection string” y anota la contraseña de la base de datos para agregarla en tu archivo `.env`.
<br />
<br />
<img width="650" alt="image" src="https://github.com/user-attachments/assets/3ed60f7f-edad-420e-a964-82aad5447b3c" />
<br />
<br />
**3.** También puedes conectar de manera directa o a través de un ORM copiando las cadenas de conexión específicas que Supabase genera para cada motor. Estas cadenas contienen el host, puerto, usuario y base de datos necesarios.
<br />
<br />
<img width="650" alt="image" src="https://github.com/user-attachments/assets/8068b583-78f9-4dfa-b729-42407e1ace04" />
<br />
<br />

### 2. Crear y configurar buckets de almacenamiento
**1.** Navega al apartado **Storage** en la consola de Supabase y haz clic en “**New Bucket**” para crear un nuevo bucket. Asigna un nombre y, de preferencia, márcalo como público (más adelante podrás ajustar las restricciones de acceso si lo requieres).
<br />
<br />
<img width="650" alt="image" src="https://github.com/user-attachments/assets/a78f732e-3990-4c5d-8f76-8648793a9683" />
<br />
<br />
**2.** Asegúrate de ubicar el nombre del bucket en tu código backend y frontend para que los archivos se almacenen en la ubicación correcta.
<br />
<br />

### 3. Obtener URL y credenciales de API
**1.** Para manipular el almacenamiento y la base de datos desde tu aplicación, necesitas la URL de tu proyecto y una clave de servicio. Dirígete a la sección **Settings** → **API**. En **Data API** encontrarás la **Project URL** que debes copiar y usar como base de tu **API**.
<br />
<br />
<img width="650" alt="image" src="https://github.com/user-attachments/assets/007902d7-f1fb-44f1-bdfa-067f7c6cc3d7" />
<br />
<br />
**2.** En la misma página, localiza el apartado “**Service key**” (o legacy anon) y copia la clave `service_role`. Esta clave debe permanecer en secreto y sólo se utiliza en el backend para operaciones que requieren permisos elevados.
<br />
<br />
<img width="650" alt="image" src="https://github.com/user-attachments/assets/4814d56c-3b98-4a1a-8518-a57220df0e6e" />
<br />
<br />
**3.** Finalmente, agrega estas variables a tu `.env` del backend como se muestra a continuación (reemplaza los valores con los de tu proyecto):
```bash
SUPABASE_URL=https://<tu-project>.supabase.co
SUPABASE_SERVICE_KEY=<tu-service-role-key>
SUPABASE_BUCKET=<nombre-del-bucket>
