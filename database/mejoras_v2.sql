USE Pruebas;

-- 1) Tabla intermedia libro <-> maestro (muchos a muchos)
CREATE TABLE IF NOT EXISTS libro_maestro (
  libro_id   INT NOT NULL,
  maestro_id INT NOT NULL,
  PRIMARY KEY (libro_id, maestro_id),
  FOREIGN KEY (libro_id)   REFERENCES libros(id)   ON DELETE CASCADE,
  FOREIGN KEY (maestro_id) REFERENCES maestros(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2) Reestructurar ventas: encabezado + detalle
DROP TABLE IF EXISTS ventas;

CREATE TABLE ventas (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  alumno_nombre VARCHAR(150)  NOT NULL,
  grado         VARCHAR(20)   NOT NULL,
  grupo         VARCHAR(20)   NOT NULL,
  turno         VARCHAR(20)   NOT NULL,
  especialidad  VARCHAR(100)  NOT NULL,
  total         DECIMAL(10,2) NOT NULL DEFAULT 0,
  fecha         DATETIME      DEFAULT CURRENT_TIMESTAMP,
  usuario_id    INT,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE venta_items (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  venta_id   INT NOT NULL,
  libro_id   INT NOT NULL,
  maestro_id INT NOT NULL,
  precio     DECIMAL(10,2) NOT NULL,
  FOREIGN KEY (venta_id)   REFERENCES ventas(id)   ON DELETE CASCADE,
  FOREIGN KEY (libro_id)   REFERENCES libros(id),
  FOREIGN KEY (maestro_id) REFERENCES maestros(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;