import { useCallback, useEffect } from 'react';
import Layout from './components/CustomLayout';
import NoteEditor from './components/NoteEditor';
import { useAtom } from 'jotai';
import { currentFileAtom, langCodeAtom } from './store/jotai';
import WorkspaceLoaded from './components/WorkspaceLoaded';
import RevedrawApp from './components/RevedrawApp';
import zhCN from 'antd/locale/zh_CN';
import zhTW from 'antd/locale/zh_TW';
import enUS from 'antd/locale/en_US';
import '@renderer/i18n';
import moment from 'moment';

moment.tz.setDefault();

import './App.css';
import { ConfigProvider } from 'antd';

function App(): JSX.Element {
  const [currentFile] = useAtom(currentFileAtom);
  const [langCode] = useAtom(langCodeAtom);

  const renderContent = useCallback((file) => {
    if (!file) return null;

    switch (file.type) {
      case 'note':
        return <NoteEditor pageId={file.id} />;
      case 'board':
        return <RevedrawApp file={file} />;
      default:
        return null;
    }
  }, []);

  const getLocale = useCallback(() => {
    switch (langCode) {
      case 'zh-CN':
        return zhCN;
      case 'zh-TW':
        return zhTW;
      default:
        return enUS;
    }
  }, [langCode]);

  return (
    <ConfigProvider locale={getLocale()}>
      <div className="revenote-app-container">
        <Layout>
          <WorkspaceLoaded>{renderContent(currentFile)}</WorkspaceLoaded>
        </Layout>
      </div>
    </ConfigProvider>
  );
}

export default App;
