import { describe, expect, it } from "vitest";
import { pgConnectionString } from "../src/db.js";

describe("database URLs", () => {
  it("accepts PlanetScale's psql extras", () => {
    const u = pgConnectionString("postgresql://app.abc123:pscale_pw_x@aws-us-east-1.horizon.psdb.cloud:5432/postgres?sslmode=verify-full&sslrootcert=system&sslnegotiation=direct");
    expect(u).toBe("postgresql://app.abc123:pscale_pw_x@aws-us-east-1.horizon.psdb.cloud:5432/postgres?sslmode=verify-full");
  });
  it("leaves other URLs alone", () => {
    expect(pgConnectionString("postgres://sitecraft:sitecraft@localhost:5432/sitecraft")).toBe("postgres://sitecraft:sitecraft@localhost:5432/sitecraft");
    expect(pgConnectionString("postgres://u:p@h/db?sslrootcert=/etc/ca.pem")).toContain("sslrootcert=%2Fetc%2Fca.pem");
  });
});
