import React, { useState } from "react";
import { Plus, Trash2, Pencil } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle, Dialog, Input, Select, formatCurrency } from "@milly-maker/ui";
import { useExpenses } from "@/db/hooks/useExpenses.js";
import { useCategories } from "@/db/hooks/useCategories.js";

function getCurrentMonthYear() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

interface FormState {
  amount: string;
  description: string;
  category_id: string;
  expense_date: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  amount: "",
  description: "",
  category_id: "",
  expense_date: new Date().toISOString().slice(0, 10),
  notes: "",
};

export function ExpensesPage() {
  const { year, month } = getCurrentMonthYear();
  const { expenses, loading, add, edit, remove } = useExpenses(year, month);
  const { expenseCategories } = useCategories();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Partial<FormState>>({});

  const categoryOptions = expenseCategories.map((c) => ({ value: c.id, label: c.name }));

  function openAdd() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setErrors({});
    setDialogOpen(true);
  }

  function openEdit(id: string) {
    const exp = expenses.find((e) => e.id === id);
    if (!exp) return;
    setEditingId(id);
    setForm({
      amount: String(exp.amount),
      description: exp.description,
      category_id: exp.category_id,
      expense_date: exp.expense_date,
      notes: exp.notes ?? "",
    });
    setErrors({});
    setDialogOpen(true);
  }

  function validate(): boolean {
    const e: Partial<FormState> = {};
    if (!form.amount || isNaN(Number(form.amount)) || Number(form.amount) <= 0)
      e.amount = "Enter a valid amount";
    if (!form.description.trim()) e.description = "Description is required";
    if (!form.category_id) e.category_id = "Select a category";
    if (!form.expense_date) e.expense_date = "Date is required";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    const data = {
      amount: Number(form.amount),
      description: form.description.trim(),
      category_id: form.category_id,
      expense_date: form.expense_date,
      notes: form.notes.trim() || undefined,
    };
    if (editingId) {
      await edit(editingId, data);
    } else {
      await add(data);
    }
    setSaving(false);
    setDialogOpen(false);
  }

  // Group by week
  const byWeek = expenses.reduce<Record<string, typeof expenses>>((acc, exp) => {
    const week = exp.week_start;
    acc[week] = [...(acc[week] ?? []), exp];
    return acc;
  }, {});

  const weekKeys = Object.keys(byWeek).sort((a, b) => b.localeCompare(a));
  const monthTotal = expenses.reduce((s, e) => s + e.amount, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Expenses</h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            {new Date(year, month - 1).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
            {" · "}
            <span className="font-medium text-[var(--color-text)]">{formatCurrency(monthTotal)}</span>
          </p>
        </div>
        <Button onClick={openAdd} size="sm">
          <Plus size={15} /> Add Expense
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>
      ) : weekKeys.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-[var(--color-text-muted)]">
            No expenses yet this month.{" "}
            <button onClick={openAdd} className="text-[var(--color-primary)] underline">Add one</button>.
          </CardContent>
        </Card>
      ) : (
        weekKeys.map((week) => {
          const items = byWeek[week]!;
          const weekTotal = items.reduce((s, e) => s + e.amount, 0);
          return (
            <Card key={week}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold">
                    Week of {new Date(week + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </CardTitle>
                  <span className="text-sm font-medium text-[var(--color-text-muted)]">{formatCurrency(weekTotal)}</span>
                </div>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-[var(--color-border-subtle)]">
                    {items.map((exp) => (
                      <tr key={exp.id} className="group">
                        <td className="py-2 pr-3">
                          <span
                            className="mr-2 inline-block h-2 w-2 rounded-full"
                            style={{ backgroundColor: exp.category_color }}
                          />
                          {exp.description}
                        </td>
                        <td className="py-2 pr-3 text-[var(--color-text-muted)]">{exp.category_name}</td>
                        <td className="py-2 pr-3 text-[var(--color-text-muted)]">
                          {new Date(exp.expense_date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </td>
                        <td className="py-2 text-right font-medium">{formatCurrency(exp.amount)}</td>
                        <td className="py-2 pl-3 opacity-0 transition-opacity group-hover:opacity-100">
                          <div className="flex gap-1">
                            <button
                              onClick={() => openEdit(exp.id)}
                              className="rounded p-1 text-[var(--color-text-subtle)] hover:text-[var(--color-text)]"
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              onClick={() => remove(exp.id)}
                              className="rounded p-1 text-[var(--color-text-subtle)] hover:text-[var(--color-danger)]"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          );
        })
      )}

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editingId ? "Edit Expense" : "Add Expense"}
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Amount"
            type="number"
            step="0.01"
            min="0.01"
            placeholder="0.00"
            value={form.amount}
            onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            error={errors.amount}
          />
          <Input
            label="Description"
            placeholder="e.g. Whole Foods run"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            error={errors.description}
          />
          <Select
            label="Category"
            options={categoryOptions}
            placeholder="Select category"
            value={form.category_id}
            onChange={(e) => setForm((f) => ({ ...f, category_id: e.target.value }))}
            error={errors.category_id}
          />
          <Input
            label="Date"
            type="date"
            value={form.expense_date}
            onChange={(e) => setForm((f) => ({ ...f, expense_date: e.target.value }))}
            error={errors.expense_date}
          />
          <Input
            label="Notes (optional)"
            placeholder="Any extra context"
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : editingId ? "Save Changes" : "Add Expense"}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
