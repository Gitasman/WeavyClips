(() => {
  const copy={
    en:{
      title:'Weavy Clips Help',intro:'Save once. Reuse on your Weavy canvas.',back:'Settings',languageLabel:'Language',automatic:'Automatic',
      startTitle:'Get started',start:'Open app.weavy.ai and select what you want to save. Click 💾 on the dock. Your clip appears as a pinned button. Click a clip to paste it using your selected paste method. Open Settings with ⚙️ or the extension icon.',
      searchTitle:'Find and organize',search:'Press Alt+K for quick search: type a name, group, or words from a text clip. Use ↑ / ↓ and Enter. Escape closes search.\nClips Manager has All, Pinned, Images, Text and JSON filters. Click a name to rename it; Enter saves and Escape cancels. Drag clips to reorder. Deleting a clip offers a short Undo action.',
      appearanceTitle:'Make it yours',appearance:'Appearance changes the dock. Settings Page changes the settings background, sections and dot pattern. Choose Default, Glass, Solid or Compact, or save your own preset.\nBlur is visible through a partly transparent background. At 100% opacity the background hides the blur. Set shadow strength or outline thickness to zero to remove them completely.',
      backupTitle:'Keep a backup',backup:'In Settings → Backup, use Export JSON to save your clips, history, settings and custom presets. Import JSON adds clips whose IDs are not already in your library. Invalid backups are rejected before adding clips. The import file limit is 64 MB.\nData stays in this browser profile. GitHub does not synchronize your clips. Backups contain your actual content, so keep them private.',
      updateTitle:'Update safely',update:'Export a backup first. Download the latest ZIP from GitHub, unpack it separately, then copy the new files into the same folder Chrome already uses. Do not remove the extension. Click Reload in chrome://extensions, refresh all Weavy tabs and reopen Settings.\nGitHub installs do not update automatically.',
      troubleTitle:'If something goes wrong',trouble:'A failed clip save keeps its pending edits in the open page. Use Retry when offered; keep that page open until the save succeeds. For failed settings saves, change a setting to retry.\nIf paste does not work, check Clipboard & Paste, try Copy only and paste manually. Export a backup before troubleshooting. Diagnostics can be copied when reporting a problem.',
      offline:'This guide is bundled with the extension and works offline.'
    },
    ru:{
      title:'Справка Weavy Clips',intro:'Сохраните один раз. Используйте снова на холсте Weavy.',back:'Настройки',languageLabel:'Язык',automatic:'Автоматически',
      startTitle:'Начало работы',start:'Откройте app.weavy.ai и выделите то, что хотите сохранить. Нажмите 💾 на доке. Клип появится в виде закреплённой кнопки. Нажмите клип для вставки выбранным способом. Настройки открываются через ⚙️ или значок расширения.',
      searchTitle:'Поиск и организация',search:'Alt+K открывает быстрый поиск: ищите по имени, группе или словам из текстового клипа. ↑ / ↓ выбирают результат, Enter использует его, Escape закрывает поиск.\nВ Clips Manager есть фильтры All, Pinned, Images, Text и JSON. Нажмите имя для переименования: Enter сохраняет, Escape отменяет. Перетаскивайте клипы для изменения порядка. После удаления доступна кратковременная отмена Undo.',
      appearanceTitle:'Оформление',appearance:'Appearance меняет док. Settings Page меняет фон настроек, разделы и точечный паттерн. Выберите Default, Glass, Solid или Compact либо сохраните свой пресет.\nBlur виден сквозь частично прозрачный фон. При непрозрачности 100% фон закрывает размытие. Нулевая сила тени или толщина обводки полностью отключают соответствующий эффект.',
      backupTitle:'Резервная копия',backup:'В Settings → Backup нажмите Export JSON для сохранения клипов, истории, настроек и своих пресетов. Import JSON добавляет клипы, ID которых ещё нет в библиотеке. Некорректные файлы отклоняются до добавления клипов. Лимит файла импорта — 64 МБ.\nДанные хранятся в этом профиле браузера. GitHub не синхронизирует клипы. Копия содержит сами данные клипов — храните её у себя.',
      updateTitle:'Обновление без потери данных',update:'Сначала экспортируйте резервную копию. Скачайте свежий ZIP с GitHub, распакуйте отдельно и скопируйте новые файлы в ту же папку, которую уже использует Chrome. Не удаляйте расширение. Нажмите обновление в chrome://extensions, обновите все вкладки Weavy и заново откройте настройки.\nУстановка из GitHub не обновляется автоматически.',
      troubleTitle:'Если что-то не работает',trouble:'Если клипы не сохранились, изменения остаются в открытой странице. Нажмите Retry, когда она появится; не закрывайте страницу до успешного сохранения. После ошибки сохранения настроек измените любую настройку для повтора.\nПри проблемах со вставкой проверьте Clipboard & Paste, попробуйте Copy only и вставьте вручную. До диагностики экспортируйте копию. Данные Diagnostics можно скопировать для сообщения об ошибке.',
      offline:'Справка входит в расширение и доступна без интернета.'
    }
  };
  function language(languages=[],preference='auto'){
    if(preference==='en'||preference==='ru')return preference;
    for(const locale of languages){const code=String(locale).toLowerCase().split('-')[0];if(code==='en'||code==='ru')return code;}
    return 'en';
  }
  globalThis.WeavyHelp={copy,language};
  if(typeof document==='undefined')return;
  const select=document.getElementById('help-language');
  function render(preference){
    const lang=language(navigator.languages||[navigator.language],preference),strings=copy[lang];
    document.documentElement.lang=lang;document.title=strings.title;
    document.querySelectorAll('[data-help]').forEach(el=>el.textContent=strings[el.dataset.help]||'');
    select.querySelector('[value="auto"]').textContent=strings.automatic;
  }
  select.addEventListener('change',()=>{render(select.value);chrome.storage.local.set({helpLanguage:select.value}).catch(()=>{});});
  render('auto');
  chrome.storage.local.get(['helpLanguage','settings']).then(result=>{
    select.value=['en','ru'].includes(result.helpLanguage)?result.helpLanguage:'auto';render(select.value);
    if(globalThis.WeavyAppearance){
      const A=WeavyAppearance,s=A.normalize(result.settings||{}),style=document.documentElement.style;
      for(const [key,value] of Object.entries({'--page-bg':s.settingsBgColor,'--panel-bg':s.settingsPanelColor,'--page-fg':A.foreground(s.settingsBgColor),'--panel-fg':A.foreground(s.settingsPanelColor),'--accent':s.settingsAccentColor,'--pattern-size':s.settingsPatternSpacing+'px','--pattern':s.settingsPatternEnabled?`rgba(${A.rgb(A.foreground(s.settingsBgColor)).join(',')},${s.settingsPatternOpacity/100})`:'transparent'}))style.setProperty(key,value);
      style.colorScheme=A.foreground(s.settingsBgColor)==='#ffffff'?'dark':'light';
    }
  }).catch(()=>{});
})();
