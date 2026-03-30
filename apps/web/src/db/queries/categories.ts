import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";

export interface Category {
  id: string;
  name: string;
  type: "expense" | "income";
  color: string;
  icon: string;
}

export async function getAllCategories(conn: AsyncDuckDBConnection): Promise<Category[]> {
  const result = await conn.query("SELECT id, name, type, color, icon FROM categories ORDER BY type, name");
  return result.toArray() as unknown as Category[];
}
