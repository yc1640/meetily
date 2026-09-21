"use client";

import { Globe2 } from "lucide-react";
import { useAppLanguage } from "@/contexts/AppLanguageContext";

export function AppLanguageSettings() {
  const { appLanguage, setAppLanguage, t } = useAppLanguage();

  return (
    <section className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
      <div className="flex items-start gap-3">
        <Globe2 className="mt-0.5 h-5 w-5 text-gray-600" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <label htmlFor="app-language" className="text-lg font-semibold text-gray-900">{t("appLanguage")}</label>
          <p className="mt-1 text-sm text-gray-600">{t("appLanguageDescription")}</p>
          <select id="app-language" value={appLanguage} onChange={(event) => setAppLanguage(event.target.value as typeof appLanguage)} className="mt-4 w-full max-w-xs rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500">
            <option value="zh-CN">{t("chinese")}</option>
            <option value="en">{t("english")}</option>
          </select>
        </div>
      </div>
    </section>
  );
}
