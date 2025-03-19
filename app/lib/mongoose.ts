import mongoose from 'mongoose';

const connectToDatabase = async (): Promise<void> => {
  if (mongoose.connections[0].readyState) {
    // Se già connesso, non fare nulla
    return;
  }

  const uri = 'mongodb+srv://cmhsrl2017:UlLWlkOP1xR1qX2b@cluster0.vlri2.mongodb.net/eosmapper'; // Sostituisci con il tuo URL del database

  try {
    await mongoose.connect(uri); // Opzioni rimosse
    console.log('Connesso a MongoDB');
  } catch (error) {
    console.error('Errore di connessione a MongoDB:', error);
    throw new Error('Errore di connessione al database');
  }
};

export default connectToDatabase;