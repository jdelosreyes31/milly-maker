import { useState, useEffect } from "react";
import { useDb } from "./useDb.js";
import type { Category } from "../queries/categories.js";
import { getAllCategories } from "../queries/categories.js";

export function useCategories() {
  const { conn } = useDb();
  const [categories, setCategories] = useState<Category[]>([]);

  useEffect(() => {
    if (!conn) return;
    void getAllCategories(conn).then(setCategories);
  }, [conn]);

  const expenseCategories = categories.filter((c) => c.type === "expense");
  const incomeCategories = categories.filter((c) => c.type === "income");

  return { categories, expenseCategories, incomeCategories };
}
