import { Globe } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "./index";

const languages = [
  { code: "en-US", label: "English" },
  { code: "zh-CN", label: "简体中文" },
];

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation("common");
  const currentLanguage = i18n.language;

  const toggleLanguage = () => {
    const nextLanguage = currentLanguage === "en-US" ? "zh-CN" : "en-US";
    i18n.changeLanguage(nextLanguage);
  };

  const currentLabel = languages.find(lang => lang.code === currentLanguage)?.label || "English";

  return (
    <Button
      className="button secondary language-switcher"
      onClick={toggleLanguage}
      title={t("common:components.switchLanguage")}
    >
      <Globe size={14} />
      <span className="language-switcher__label">{currentLabel}</span>
    </Button>
  );
}
