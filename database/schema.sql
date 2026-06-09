USE Pruebas;

-- Tabla del personal que puede entrar al sistema
CREATE TABLE IF NOT EXISTS usuarios (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  nombre        VARCHAR(100) NOT NULL,
  usuario       VARCHAR(50)  NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  activo        TINYINT(1)   NOT NULL DEFAULT 1,
  creado_en     TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Libros que deja la editorial
CREATE TABLE IF NOT EXISTS libros (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  titulo             VARCHAR(200)  NOT NULL,
  autor              VARCHAR(150),
  precio             DECIMAL(10,2) NOT NULL,
  margen_papeleria   DECIMAL(10,2) NOT NULL DEFAULT 0,
  cantidad_entregada INT           NOT NULL DEFAULT 0,
  stock_actual       INT           NOT NULL DEFAULT 0,
  activo             TINYINT(1)    NOT NULL DEFAULT 1,
  creado_en          TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Maestros de la escuela
CREATE TABLE IF NOT EXISTS maestros (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  nombre_completo VARCHAR(150) NOT NULL,
  activo          TINYINT(1)   NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Ventas (el corazón del sistema)
CREATE TABLE IF NOT EXISTS ventas (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  libro_id      INT           NOT NULL,
  alumno_nombre VARCHAR(150)  NOT NULL,
  maestro_id    INT           NOT NULL,
  grado         VARCHAR(20)   NOT NULL,
  grupo         VARCHAR(20)   NOT NULL,
  especialidad  VARCHAR(50)   NOT NULL,
  turno         VARCHAR(20)   NOT NULL,
  total         DECIMAL(10,2) NOT NULL,
  fecha         DATETIME      DEFAULT CURRENT_TIMESTAMP,
  usuario_id    INT,
  FOREIGN KEY (libro_id)   REFERENCES libros(id),
  FOREIGN KEY (maestro_id) REFERENCES maestros(id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;