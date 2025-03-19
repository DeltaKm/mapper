// import mongoose, { Schema, Document } from 'mongoose';

// // Definizione dell'interfaccia per il modello Mongoose
// interface IDynamicData extends Document {
//   dynamicFields: Map<string, any>;
//   restaurant_code?: string;
//   subscriber_code?: string;
// }

// const dynamicDataSchema = new Schema<IDynamicData>(
//   {
//     dynamicFields: { type: Map, of: Schema.Types.Mixed, required: true },
//     restaurant_code: { type: String, required: false },
//     subscriber_code: { type: String, required: false },
//   },
//   { timestamps: true }
// );

// // Creazione del modello Mongoose
// const DynamicData = mongoose.model<IDynamicData>('DynamicData', dynamicDataSchema);

// export default DynamicData;

import mongoose, { Schema, Document } from 'mongoose';

interface IDynamicData extends Document {
  [key: string]: any;  // Permette campi dinamici
}

const dynamicDataSchema = new Schema<IDynamicData>(
  {
    restaurant_code: { type: String, required: false },
    subscriber_code: { type: String, required: false },
  },
  { timestamps: true, strict: false }  // Aggiungi `strict: false` per permettere campi dinamici
);

const DynamicData = mongoose.model<IDynamicData>('DynamicData', dynamicDataSchema);

export default DynamicData;


