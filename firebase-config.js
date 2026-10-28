// ============================================================
//  ViagemControl - Configuração e Conexão Firebase Firestore
// ============================================================

const firebaseConfig = {
  apiKey: "AIzaSyCkARwt2-d74oha9TaDcFdU__lxFjqgDUw",
  authDomain: "controle-viagem-d2f9e.firebaseapp.com",
  projectId: "controle-viagem-d2f9e",
  storageBucket: "controle-viagem-d2f9e.firebasestorage.app",
  messagingSenderId: "35616331944",
  appId: "1:35616331944:web:07a46b1efdad837bdd8a9d",
  measurementId: "G-RNXEQJVNKB"
};

// Inicializa o Firebase
let db = null;
let isFirebaseReady = false;

try {
    if (typeof firebase !== 'undefined') {
        firebase.initializeApp(firebaseConfig);
        db = firebase.firestore();
        
        // Habilita persistência de cache offline se disponível
        db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
            if (err.code === 'failed-precondition') {
                console.warn('Múltiplas abas abertas, persistência ativada na primeira aba.');
            } else if (err.code === 'unimplemented') {
                console.warn('O navegador não suporta persistência offline do Firestore.');
            }
        });
        isFirebaseReady = true;
        console.log('🔥 Firebase Firestore inicializado com sucesso!');
    }
} catch (e) {
    console.error('Erro ao inicializar Firebase:', e);
}
